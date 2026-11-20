plugins {
  alias(libs.plugins.android.application)
}

android {
  namespace = "com.alger.musicplayer"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.alger.musicplayer"
    minSdk = 26
    targetSdk = 35
    versionCode = 51005
    versionName = "5.1.0-android"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // Sign release with debug keystore so release APK is directly installable on phones
      signingConfig = signingConfigs.getByName("debug")
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
