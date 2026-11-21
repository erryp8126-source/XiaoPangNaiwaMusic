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

android {
  namespace = "com.alger.musicplayer"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.alger.musicplayer"
    minSdk = 26
    targetSdk = 35
    versionCode = 51400
    versionName = "5.1.4"
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
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // 优先使用固定正式签名证书（本地与 GitHub Actions 签名永久一致，支持直接覆盖升级）；
      // 若第三方克隆构建未配置 keystore，则优雅回退到 debug 签名
      signingConfig = if (hasReleaseKeystore) {
        signingConfigs.getByName("release")
      } else {
        signingConfigs.getByName("debug")
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
