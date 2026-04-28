import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        'tests/importExport/ImportExportDialog.test.tsx',
        'tests/importExport/ImportTab.test.tsx',
        'tests/importExport/ExportTab.test.tsx',
        'tests/importExport/ImportExportCSV.test.ts',
        'tests/importExport/ImportVendors.test.ts',
        'tests/sync/useImportExport.test.ts',
      ],
      coverage: {
        all: true,
        include: [
          'src/hooks/sync/useImportExport.ts',
          'src/components/ImportExport/utils.ts',
          'src/components/ImportExport/ImportTab.tsx',
          'src/components/ImportExport/index.tsx',
        ],
        reportsDirectory: '.copilot/import-export-coverage',
        thresholds: {
          lines: 0,
          statements: 0,
          functions: 0,
          branches: 0,
        },
      },
    },
  }),
);