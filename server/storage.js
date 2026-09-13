/* ============================================================
   Where the photos live.

     S3_BUCKET set   -> S3. Reads are served as a short-lived presigned
                        redirect, so the image bytes never pass through
                        Lambda: no 6 MB response ceiling, no egress through
                        the function, no cold-start cost on a thumbnail.
     S3_BUCKET unset -> a local folder, for development.

   Both expose put / del / read. `read` returns either { redirect } or
   { stream, contentType } and the image route handles whichever it gets.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const BUCKET = process.env.S3_BUCKET || '';
const PREFIX = process.env.S3_PREFIX || 'submissions/';
const REGION = process.env.AWS_REGION || 'us-east-1';
const SIGNED_URL_TTL = Number(process.env.SIGNED_URL_TTL) || 300;   // seconds
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

const TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif'
};
const contentTypeFor = (key) => TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream';

/* ---------------------------------------------------- S3 */
function s3Impl() {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const client = new S3Client({ region: REGION });
  const objectKey = (key) => PREFIX + key;

  return {
    kind: 's3',
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({
        Bucket: BUCKET, Key: objectKey(key), Body: body,
        ContentType: contentType || contentTypeFor(key)
      }));
      return key;
    },
    async del(key) {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objectKey(key) }));
    },
    async read(key) {
      /* The bucket stays private. A presigned URL is an authorisation this
         request already earned, narrowed to one object and a few minutes. */
      const url = await getSignedUrl(client,
        new GetObjectCommand({ Bucket: BUCKET, Key: objectKey(key) }),
        { expiresIn: SIGNED_URL_TTL });
      return { redirect: url, maxAge: SIGNED_URL_TTL };
    }
  };
}

/* ---------------------------------------------------- local disk */
function localImpl() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  /* basename() so a crafted key can never escape the upload folder. */
  const filePath = (key) => path.join(UPLOAD_DIR, path.basename(key));

  return {
    kind: 'local',
    async put(key, body) { fs.writeFileSync(filePath(key), body); return key; },
    async del(key) { try { fs.unlinkSync(filePath(key)); } catch (e) { /* already gone */ } },
    async read(key) {
      const file = filePath(key);
      if (!fs.existsSync(file)) return null;
      return { stream: fs.createReadStream(file), contentType: contentTypeFor(key) };
    }
  };
}

const impl = BUCKET ? s3Impl() : localImpl();

module.exports = {
  put: (key, body, type) => impl.put(key, body, type),
  del: (key) => impl.del(key),
  read: (key) => impl.read(key),
  kind: impl.kind,
  contentTypeFor,
  UPLOAD_DIR
};
