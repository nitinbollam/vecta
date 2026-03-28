/**
 * Re-encrypt PII after VECTA_FIELD_ENCRYPTION_KEY rotation.
 * Run from monorepo root with gateway env loaded:
 *   npm run reencrypt-pii --workspace=api-gateway
 *
 * Expects NEW_VECTA_FIELD_ENCRYPTION_KEY in env (new key active) and decrypt
 * still works with old key only if you run a two-phase migration — this script
 * assumes decryptField/encryptField use the current env key (single-key mode).
 * For dual-key rotation, extend @vecta/crypto first.
 */

import '../src/load-env';
import { query } from '@vecta/database';
import { encryptField, decryptField } from '@vecta/crypto';

function cellToToken(v: unknown): string | null {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return String(v);
}

async function reencryptPII(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('Starting PII re-encryption…');

  const students = await query<{
    id: string;
    passport_number_enc: unknown;
    date_of_birth_enc: unknown;
    nationality_enc: unknown;
  }>(
    `SELECT id, passport_number_enc, date_of_birth_enc, nationality_enc
     FROM students
     WHERE passport_number_enc IS NOT NULL`,
  );

  for (const student of students.rows) {
    try {
      const pTok = cellToToken(student.passport_number_enc);
      const dTok = cellToToken(student.date_of_birth_enc);
      const nTok = cellToToken(student.nationality_enc);

      const passportNumber = pTok ? decryptField(pTok) : '';
      const dob = dTok ? decryptField(dTok) : '';
      const nationality = nTok ? decryptField(nTok) : '';

      await query(
        `UPDATE students
         SET passport_number_enc = $1, date_of_birth_enc = $2, nationality_enc = $3
         WHERE id = $4`,
        [
          passportNumber ? encryptField(passportNumber) : null,
          dob ? encryptField(dob) : null,
          nationality ? encryptField(nationality) : null,
          student.id,
        ],
      );
      // eslint-disable-next-line no-console
      console.log(`Re-encrypted student ${student.id}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Failed student ${student.id}`, e);
    }
  }

  // eslint-disable-next-line no-console
  console.log('PII re-encryption complete');
}

void reencryptPII().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
