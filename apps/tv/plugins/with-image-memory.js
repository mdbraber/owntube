/**
 * Decode images as RGB_565 instead of ARGB_8888: half the memory per pixel.
 *
 * Every card on screen (and on screens kept mounted behind it) holds its
 * decoded thumbnail, and Fresco refuses new ones once its bitmap pool reaches
 * its hard cap; the thumbnails then stay blank. Thumbnails are JPEGs, so the
 * alpha channel ARGB spends a byte per pixel on carries nothing; the cost is
 * slight banding in smooth gradients.
 *
 * React Native takes a Fresco config only through MainReactPackage's
 * MainPackageConfig, which Expo's generated MainApplication doesn't pass, so
 * this rewrites its `PackageList(this)` call to hand one in. The config otherwise
 * matches FrescoModule's default (OkHttp fetcher, automatic downsampling),
 * minus the cookie forwarding thumbnails don't need.
 */
const {
  withMainApplication,
  createRunOncePlugin,
} = require("expo/config-plugins");

// Expo 52 assigned `val packages = PackageList(this).packages`; Expo 58 passes
// `PackageList(this).packages.apply { … }` straight to the ReactHost factory.
// Swapping the call itself covers both.
const ORIGINAL = "PackageList(this).packages";

const REPLACEMENT = `PackageList( // Fresco decodes as RGB_565 (see the with-image-memory plugin).
              this,
              com.facebook.react.shell.MainPackageConfig(
                com.facebook.imagepipeline.backends.okhttp3.OkHttpImagePipelineConfigFactory
                  .newBuilder(
                    this@MainApplication,
                    com.facebook.react.modules.network.OkHttpClientProvider.createClient(),
                  )
                  .setBitmapsConfig(android.graphics.Bitmap.Config.RGB_565)
                  .setDownsampleMode(com.facebook.imagepipeline.core.DownsampleMode.AUTO)
                  .build(),
              ),
            ).packages`;

function withImageMemory(config) {
  return withMainApplication(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes("with-image-memory")) return cfg;
    if (!src.includes(ORIGINAL)) {
      throw new Error(
        "with-image-memory: MainApplication has no `PackageList(this).packages`; update the plugin for this Expo version",
      );
    }
    cfg.modResults.contents = src.replace(ORIGINAL, REPLACEMENT);
    return cfg;
  });
}

module.exports = createRunOncePlugin(
  withImageMemory,
  "with-image-memory",
  "1.0.0",
);
