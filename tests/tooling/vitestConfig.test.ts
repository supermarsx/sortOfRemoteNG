import { describe, expect, it } from "vitest";
import { availableParallelism } from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import vitestConfig, {
  NODE_TEST_SUITE_EXCLUDES,
  resolveTestWorkerCount,
} from "../../vitest.config";

describe("ordinary Vitest discovery", () => {
  it("does not rediscover verification worktrees and preimages as application source", () => {
    const config = vitestConfig as {
      test?: { exclude?: readonly string[] };
    };
    expect(config.test?.exclude).toContain(".artifacts/**");
    const typescript = JSON.parse(readFileSync("tsconfig.json", "utf8"));
    expect(typescript.exclude).toContain(".artifacts");
    expect(typescript.include).toEqual(
      expect.arrayContaining(["**/*.ts", "**/*.tsx"]),
    );
  });
  it.each([
    [1, 1],
    [2, 1],
    [4, 3],
    [8, 7],
    [9, 8],
    [16, 8],
    [64, 8],
  ])("uses %i available CPUs to select %i workers", (cpus, workers) => {
    expect(resolveTestWorkerCount(cpus)).toBe(workers);
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid available parallelism %s",
    (cpus) => {
      expect(() => resolveTestWorkerCount(cpus)).toThrow(RangeError);
    },
  );

  it("configures the worker bound from the current host capacity", () => {
    const config = vitestConfig as {
      test?: { maxWorkers?: number };
    };

    expect(config.test?.maxWorkers).toBe(
      resolveTestWorkerCount(availableParallelism()),
    );
  });

  it("leaves dedicated Node test suites to their own runners", () => {
    const config = vitestConfig as {
      test?: { exclude?: readonly string[] };
    };

    expect(NODE_TEST_SUITE_EXCLUDES).toEqual([
      "tests/readme-screenshot/**/*.mjs",
      "tests/e2e-http-fixtures/**/*.mjs",
      "tests/release/**/*.mjs",
      "tests/versioning/**/*.mjs",
      "tests/protocol/nativeAppearanceClient.test.mjs",
      "tests/protocol/nativeGoogleAppearance.test.mjs",
      "tests/protocol/nativeLoginClient.test.mjs",
      "tests/protocol/nativeLoginDigest.test.mjs",
      "tests/protocol/nativeLoginFrames.test.mjs",
      "tests/protocol/nativeLoginKeyboard.test.mjs",
      "tests/protocol/nativeTotpClient.test.mjs",
      "tests/protocol/droneScmConsent.test.mjs",
    ]);
    expect(config.test?.exclude).toEqual(
      expect.arrayContaining([...NODE_TEST_SUITE_EXCLUDES]),
    );
  });
  it("excludes every node:test module under tests/ that Vitest would otherwise discover", () => {
    const excluded = (file: string) =>
      NODE_TEST_SUITE_EXCLUDES.some((pattern) =>
        pattern.endsWith("/**/*.mjs")
          ? file.startsWith(pattern.slice(0, -"**/*.mjs".length)) &&
            file.endsWith(".mjs")
          : file === pattern,
      );
    const discovered = (readdirSync("tests", { recursive: true }) as string[])
      .map((file) => `tests/${file.replace(/\\/g, "/")}`)
      // Vitest's default include; *.node-test.mjs is deliberately outside it.
      .filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
      .filter((file) =>
        /^import\s[^;]*\sfrom\s+["']node:test["']/m.test(
          readFileSync(file, "utf8"),
        ),
      )
      .filter((file) => !excluded(file));
    expect(discovered).toEqual([]);
  });
  it("executes every excluded native browser suite with Node in the transport matrix", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const testJob = workflow
      .split("\n  browser-transport-contracts:\n")[1]
      ?.split(/\n {2}[a-z][\w-]*:\n/)[0];
    const nodeCommand = testJob
      ?.split(/\r?\n/)
      .find((line) => line.includes("run: node --test tests/protocol/"));
    expect(nodeCommand).toBeDefined();
    for (const file of NODE_TEST_SUITE_EXCLUDES.filter((path) =>
      path.startsWith("tests/protocol/"),
    )) {
      expect(nodeCommand).toContain(file);
      expect(readFileSync(file, "utf8")).toContain('from "node:test"');
    }
  });
  it("runs native std-only suites explicitly after Rust setup in the transport matrix", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const testJob = workflow
      .split("\n  browser-transport-contracts:\n")[1]
      ?.split(/\n {2}[a-z][\w-]*:\n/)[0];
    const stepName =
      "      - name: Native browser std-only contracts (Node + rustc)\n";
    const toolingStep = testJob?.split(stepName)[1]?.split(/\n {6}- /)[0];
    const command = toolingStep
      ?.split("\n")
      .find((line) => line.trim().startsWith("run:"));
    const suites = [
      "tests/tooling/nativeWarmStartup.node-test.mjs",
      "tests/tooling/nativeCredentialFocus.node-test.mjs",
      "tests/tooling/nativeNavigationFailure.node-test.mjs",
      "tests/tooling/nativeLoginDiagnostics.node-test.mjs",
      "tests/tooling/cefStartupFieldTrials.node-test.mjs",
      "tests/tooling/nativeOriginProbe.node-test.mjs",
      "tests/tooling/appStartupSteps.node-test.mjs",
      "tests/tooling/nativeEngineFailure.node-test.mjs",
      "tests/tooling/secureClipboardExit.node-test.mjs",
      "tests/tooling/webNetworkGuardLatch.node-test.mjs",
      "tests/tooling/tauriEventListenerCleanup.node-test.mjs",
      "tests/tooling/nativeBrowserStartupTask.node-test.mjs",
      "tests/tooling/nativeRendererReadiness.node-test.mjs",
    ];
    expect(command?.trim().split(/\s+/)).toEqual([
      "run:",
      "node",
      "--test",
      ...suites,
    ]);
    expect(toolingStep).not.toMatch(/continue-on-error|if:/);
    const steps = testJob?.split("\n      - ") ?? [];
    const rustSetup = steps.findIndex((step) =>
      step.startsWith("uses: dtolnay/rust-toolchain@"),
    );
    expect(rustSetup).toBeGreaterThanOrEqual(0);
    const runtimeContracts = steps.findIndex((step) =>
      step.startsWith("name: Runtime package layout and whole-matrix contract"),
    );
    const nativeContracts = steps.findIndex((step) =>
      step.startsWith(stepName.trim().slice(2)),
    );
    expect(runtimeContracts).toBe(rustSetup + 1);
    const expectedHelpers = [
      {
        name: "Native ARM tool observer contracts (Windows)",
        condition: "runner.os == 'Windows'",
        run: "python -I -B native/windows-arm-native-tools/test_observe.py",
      },
      {
        name: "Native ARM compiler contracts (Windows)",
        condition: "runner.os == 'Windows'",
        run: "python -I -B native/windows-arm-native-compile/test_compile.py",
      },
      {
        name: "Hosted x64 ARM inventory contracts (Windows)",
        condition: "runner.os == 'Windows'",
        run: "python -I -B native/windows-x64-arm-clang/test_observe.py",
      },
      {
        name: "Hosted x64 ARM toolchain contracts (Windows)",
        condition: "runner.os == 'Windows'",
        run: "python -I -B native/windows-x64-arm-toolchain/test_toolchain.py",
      },
      {
        name: "Native ARM helper contracts (Unix)",
        condition: "runner.os != 'Windows'",
        run: [
          "python3 -I -B native/windows-arm-native-tools/test_observe.py",
          "python3 -I -B native/windows-arm-native-compile/test_compile.py",
          "python3 -I -B native/windows-x64-arm-clang/test_observe.py",
          "python3 -I -B native/windows-x64-arm-toolchain/test_toolchain.py",
        ].join("\n"),
      },
    ];
    const helperSteps = steps.slice(runtimeContracts + 1, nativeContracts);
    const assertHelperBlock = (block: string[]) => {
      const parsed = block.map((step) => {
        const [name, condition, run, ...commands] = step
          .trim()
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        expect(name).toMatch(/^name: /);
        expect(condition).toMatch(/^if: /);
        expect(run).toMatch(/^run: /);
        if (run !== "run: |") expect(commands).toEqual([]);
        return {
          name: name!.slice("name: ".length),
          condition: condition!.slice("if: ".length),
          run:
            run === "run: |" ? commands.join("\n") : run!.slice("run: ".length),
        };
      });
      expect(parsed).toEqual(expectedHelpers);
    };
    assertHelperBlock(helperSteps);
    expect(nativeContracts).toBe(runtimeContracts + expectedHelpers.length + 1);
    const reordered = [...helperSteps];
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    expect(() => assertHelperBlock(reordered)).toThrow();
    expect(() => assertHelperBlock(helperSteps.slice(1))).toThrow();
    const wrongGuard = [...helperSteps];
    wrongGuard[0] = wrongGuard[0]!.replace(
      "if: runner.os == 'Windows'",
      "if: runner.os != 'Windows'",
    );
    expect(() => assertHelperBlock(wrongGuard)).toThrow();
    expect(() =>
      assertHelperBlock([
        ...helperSteps,
        "name: unrelated\nrun: echo unrelated",
      ]),
    ).toThrow();
    expect(steps[runtimeContracts]).not.toMatch(/continue-on-error|if:/);
    for (const file of suites) {
      expect(readFileSync(file, "utf8")).toContain('from "node:test"');
    }
  });
});
