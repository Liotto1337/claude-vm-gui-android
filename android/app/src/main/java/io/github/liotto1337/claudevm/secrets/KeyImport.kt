package io.github.liotto1337.claudevm.secrets

import io.github.liotto1337.claudevm.ssh.SshSession
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.userauth.password.PasswordFinder
import net.schmizz.sshj.userauth.password.Resource

/** Проверка закрытого ключа при импорте в настройках: читается ли, нужна ли парольная фраза, какого он типа. */
object KeyImport {
    sealed class Result {
        /** type — ed25519, ecdsa или rsa */
        data class Ok(val type: String) : Result()
        data object NeedsPassphrase : Result()
        data class Invalid(val message: String) : Result()
    }

    fun parse(text: String, passphrase: String?): Result {
        SshSession.ensureProvider()
        var asked = false
        val finder = object : PasswordFinder {
            override fun reqPassword(resource: Resource<*>?): CharArray? {
                asked = true
                return passphrase?.toCharArray()
            }
            override fun shouldRetry(resource: Resource<*>?) = false
        }
        return try {
            val kp = SSHClient().loadKeys(text.trim() + "\n", null, finder)
            kp.private
            Result.Ok(typeName(kp.type.toString()))
        } catch (e: Exception) {
            when {
                asked && passphrase.isNullOrEmpty() -> Result.NeedsPassphrase
                asked -> Result.Invalid("Неверная парольная фраза")
                else -> Result.Invalid("Это не закрытый ключ OpenSSH или PEM")
            }
        }
    }

    private fun typeName(sshType: String): String = when {
        sshType.contains("ed25519") -> "ed25519"
        sshType.contains("ecdsa") -> "ecdsa"
        sshType.contains("rsa") -> "rsa"
        else -> sshType.removePrefix("ssh-")
    }
}
