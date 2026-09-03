plugins {
    id("com.android.application")
}

android {
    namespace = "de.stegmann.brickmerge"
    compileSdk = 36

    defaultConfig {
        applicationId = "de.stegmann.brickmerge"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "android.app.Instrumentation"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

val syncBrickmergeRuntime by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile.resolve("brickmerge-tweaks.runtime.js"))
    into(layout.projectDirectory.dir("src/main/assets"))
    rename { "brickmerge-runtime.js" }
}

tasks.named("preBuild").configure {
    dependsOn(syncBrickmergeRuntime)
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
