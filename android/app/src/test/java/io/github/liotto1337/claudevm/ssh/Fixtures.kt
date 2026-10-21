package io.github.liotto1337.claudevm.ssh

import java.io.File

/** Фикстуры общие с TS-тестами: tests/fixtures в корне репозитория (cvg.repo задаёт Gradle). */
object Fixtures {
    val repo = File(System.getProperty("cvg.repo") ?: "../..")
    fun text(name: String): String = File(repo, "tests/fixtures/$name").readText()
    val testKey = File(System.getProperty("user.home"), ".ssh/cvg_test_ed25519")
}
