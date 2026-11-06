plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.ervo"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.ervo"
        minSdk = 26
        targetSdk = 34
        versionCode = 15
        versionName = "0.3.3"
    }

    // Every update must be signed with the same key, or phones refuse to install it.
    // GitHub Actions writes the key here from the repo's secrets; it is never committed.
    val ervoKey = file("ervo-release.p12")
    signingConfigs {
        create("ervo") {
            storeFile = ervoKey
            storeType = "pkcs12"
            storePassword = System.getenv("ERVO_KEYSTORE_PASSWORD")
            keyAlias = "ervo"
            keyPassword = System.getenv("ERVO_KEYSTORE_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Without the key (a local test build), fall back to the debug key
            signingConfig = signingConfigs.getByName(if (ervoKey.exists()) "ervo" else "debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // The app screens live in docs/app (shared with the iPhone web app).
    // They're copied into the APK as assets/www at build time.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/ervoScreens"))
}

val copyAppScreens by tasks.registering(Sync::class) {
    from(rootProject.file("../docs/app")) {
        exclude("sw.js", "manifest.webmanifest")
    }
    into(layout.buildDirectory.dir("generated/ervoScreens/www"))
}

tasks.named("preBuild") {
    dependsOn(copyAppScreens)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    // Steps for Ervo Stats. alpha08 is the newest that builds with compileSdk 34.
    implementation("androidx.health.connect:connect-client:1.1.0-alpha08")
}
