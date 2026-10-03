import assert from 'node:assert/strict'
import test from 'node:test'
import { czyBladCertyfikatu, pobierzBajtyMsip } from './msip-obraz.mjs'

test('czyBladCertyfikatu: rozpoznaje odrzucony certyfikat, nie zwykłe awarie sieci', () => {
  assert.equal(
    czyBladCertyfikatu({
      message: 'fetch failed',
      cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
    }),
    true,
  )
  assert.equal(
    czyBladCertyfikatu({ message: 'fetch failed', cause: { code: 'CERT_HAS_EXPIRED' } }),
    true,
  )
  assert.equal(
    czyBladCertyfikatu({ message: 'fetch failed', cause: { message: 'self-signed certificate' } }),
    true,
  )
  assert.equal(
    czyBladCertyfikatu({ message: 'fetch failed', cause: { code: 'ECONNRESET' } }),
    false,
  )
  assert.equal(czyBladCertyfikatu({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), true)
  assert.equal(czyBladCertyfikatu({ message: 'https://msip.um.krakow.pl/x → 503' }), false)
  // w komunikacie bywa cały URL: przypadkowe „cert” czy „ssl” w adresie nie jest błędem certyfikatu
  assert.equal(czyBladCertyfikatu({ message: 'https://msip.um.krakow.pl/ssl/cert → 503' }), false)
  assert.equal(czyBladCertyfikatu(new Error('The operation was aborted due to timeout')), false)
})

test('pobierzBajtyMsip: odmawia pobrania z innego hosta niż MSIP (bez sieci)', async () => {
  await assert.rejects(
    pobierzBajtyMsip('https://example.com/obraz.png'),
    /tylko z msip\.um\.krakow\.pl/,
  )
})
