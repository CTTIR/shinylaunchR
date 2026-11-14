const path = require('node:path');
const { Arch } = require('electron-builder');
const { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire, FuseState } = require('@electron/fuses');

const policy = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
};
async function verify(binary) {
  const wire = await getCurrentFuseWire(binary);
  for (const [key, enabled] of Object.entries(policy)) {
    if (wire[key] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE)) {
      throw new Error(`Packaged fuse ${key} does not match policy`);
    }
  }
  console.log(`Verified packaged Electron fuses: ${binary}`);
}
module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const name = packager.appInfo.productFilename;
  const binary = path.join(appOutDir, electronPlatformName === 'darwin' ? `${name}.app` : (electronPlatformName === 'win32' ? `${name}.exe` : packager.executableName));
  await flipFuses(binary, {
    version: FuseVersion.V1,
    ...policy,
    // Apple Silicon validates executable pages even in unsigned local builds.
    // The final release signing step still runs after this packaging hook.
    resetAdHocDarwinSignature: electronPlatformName === 'darwin' &&
      (context.arch === Arch.arm64 || context.arch === Arch.universal),
  });
  await verify(binary);
};
module.exports.verify = verify;
