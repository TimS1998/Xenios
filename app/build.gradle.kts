plugins {
    id("com.android.application") version "9.4.1" apply false
    // AGP 9 kompiliert Kotlin selbst (built-in Kotlin); dieser Eintrag legt nur die Kotlin-Version fest.
    id("org.jetbrains.kotlin.android") version "2.4.21" apply false
}
