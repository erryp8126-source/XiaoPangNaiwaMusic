import org.gradle.api.GradleException
import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
}

val keystoreProps = Properties()
val keystorePropsFile = rootProject.file("keystore.properties")
if (keystorePropsFile.exists()) {
  keystorePropsFile.inputStream().use { keystoreProps.load(it) }
}

val releaseStorePath = System.getenv("ANDROID_KEYSTORE_PATH")
  ?: keystoreProps.getProperty("storeFile")
val releaseStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
  ?: keystoreProps.getProperty("storePassword")
val releaseKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
  ?: keystoreProps.getProperty("keyAlias")
val releaseKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")
  ?: keystoreProps.getProperty("keyPassword")
val hasReleaseKeystore = !releaseStorePath.isNullOrBlank() &&
  !releaseStorePassword.isNullOrBlank() &&
  !releaseKeyAlias.isNullOrBlank() &&
  !releaseKeyPassword.isNullOrBlank() &&
  file(releaseStorePath).exists()

val allowDebugSigning =
  (project.findProperty("allowDebugSigning")?.toString()?.equals("true", ignoreCase = true) == true)

android {
  namespace = "com.xiaopang.naiwamusic"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.xiaopang.naiwamusic"
    minSdk = 26
    targetSdk = 35
    versionCode = 10001
    versionName = "1.0.1"
  }

  signingConfigs {
    if (hasReleaseKeystore) {
      create("release") {
        storeFile = file(releaseStorePath!!)
        storePassword = releaseStorePassword
        keyAlias = releaseKeyAlias
        keyPassword = releaseKeyPassword
        enableV1Signing = true
        enableV2Signing = true
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = when {
        hasReleaseKeystore -> signingConfigs.getByName("release")
        allowDebugSigning -> {
          logger.warn(
            "[XiaoPangNaiwaMusic] Using debug signing for Release build (-PallowDebugSigning=true). Do NOT distribute publicly."
          )
          signingConfigs.getByName("debug")
        }
        else -> null
      }
    }
    debug {
      isDebuggable = true
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    buildConfig = true
    aidl = false
    shaders = false
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

gradle.taskGraph.whenReady {
  val isReleaseBuildRequested = allTasks.any { task ->
    task.project == project &&
      (task.name.equals("assembleRelease", ignoreCase = true) ||
        task.name.equals("bundleRelease", ignoreCase = true) ||
        task.name.equals("packageRelease", ignoreCase = true))
  }
  if (isReleaseBuildRequested && !hasReleaseKeystore && !allowDebugSigning) {
    throw GradleException(
      "Release build aborted: missing release keystore (configure android/keystore.properties or ANDROID_KEYSTORE_PATH/PASSWORD/ALIAS env vars). " +
        "For local debug verification only, pass -PallowDebugSigning=true."
    )
  }
}

kotlin {
  jvmToolchain(17)
}

dependencies {
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.appcompat)
  implementation(libs.androidx.activity.ktx)
  implementation(libs.androidx.webkit)
  implementation(libs.androidx.media)

  // AndroidX Media3 (ExoPlayer + MediaSession + OkHttp DataSource)
  implementation(libs.androidx.media3.exoplayer)
  implementation(libs.androidx.media3.exoplayer.hls)
  implementation(libs.androidx.media3.session)
  implementation(libs.androidx.media3.datasource.okhttp)

  // Embedded local HTTP server + HTTP client + JSON + QR
  implementation(libs.okhttp)
  implementation(libs.nanohttpd)
  implementation(libs.gson)
  implementation(libs.zxing.core)
  implementation(libs.kotlinx.coroutines.android)

  testImplementation(libs.junit)
}
