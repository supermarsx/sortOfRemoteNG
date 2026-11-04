// Exact inverse of the asset-upload recovery change in
// scripts/lib/cef-engineering-checkpoint.mjs. The historical-producer pin
// chains restore older bytes from the current file; this removes the recovery
// helper and puts back the two direct uploads so those chains stay exact.
const START = "export const UPLOAD_RECOVERY = ";
const END = "export async function verifyProducer(";
const direct = (name) =>
  "      const uploaded = await api(\n" +
  "        `releases/${release.id}/assets?name=${encodeURIComponent(" +
  name +
  ".name)}`,\n" +
  "        {\n" +
  '          method: "POST",\n' +
  "          upload: true,\n" +
  "          bodyBytes: " +
  name +
  ".bytes,\n" +
  "          body: createReadStream(path.join(bundle, " +
  name +
  ".name)),\n" +
  "        },\n" +
  "      );";
const recovered = (name) =>
  "      const uploaded = await uploadAssetWithRecovery(\n" +
  "        api,\n" +
  "        release.id,\n" +
  "        " +
  name +
  ",\n" +
  "        bundle,\n" +
  "      );";
export function withoutUploadRecovery(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (
    start < 0 ||
    end <= start ||
    text.indexOf(START, start + 1) >= 0 ||
    text.indexOf(END, end + 1) >= 0
  )
    throw new Error("Upload recovery helper not found exactly once");
  let restored = text.slice(0, start) + text.slice(end);
  for (const name of ["p", "pin"]) {
    if (restored.split(recovered(name)).length !== 2)
      throw new Error(`Upload recovery call site ${name} not found once`);
    restored = restored.replace(recovered(name), () => direct(name));
  }
  return restored;
}
