package io.github.liotto1337.claudevm.secrets

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.github.liotto1337.claudevm.ssh.SecretSource
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Ключ шифрования секретов. */
fun interface KeyProvider {
    fun key(): SecretKey
}

/** AES-256 в Android Keystore: из приложения не извлекается, пропадает при переустановке. */
class AndroidKeystoreProvider(private val alias: String = "cvg-secrets") : KeyProvider {
    override fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return gen.generateKey()
    }
}

/**
 * Пароль, закрытый ключ и его парольная фраза: AES-256-GCM, шифротекст (IV + данные, base64) в SharedPreferences «cvg-secrets».
 * В JS не передаются — только признаки has(): yes, no или unreadable (ключ Keystore потерян, данные повреждены).
 */
class SecretStore(ctx: Context, private val keys: KeyProvider = AndroidKeystoreProvider()) : SecretSource {
    private val prefs = ctx.getSharedPreferences("cvg-secrets", Context.MODE_PRIVATE)

    fun save(name: String, value: String?) {
        if (value.isNullOrEmpty()) {
            prefs.edit().remove(name).commit()
            return
        }
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, keys.key()) }
        val data = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(name, Base64.getEncoder().encodeToString(data)).commit()
    }

    fun has(name: String): String = when {
        !prefs.contains(name) -> "no"
        read(name) == null -> "unreadable"
        else -> "yes"
    }

    override fun read(name: String): String? {
        val stored = prefs.getString(name, null) ?: return null
        return runCatching {
            val data = Base64.getDecoder().decode(stored)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, keys.key(), GCMParameterSpec(128, data, 0, IV))
            String(cipher.doFinal(data, IV, data.size - IV), Charsets.UTF_8)
        }.getOrNull()
    }

    private companion object {
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV = 12
    }
}
