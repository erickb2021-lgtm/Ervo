plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.ervo"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.ervo"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
}
