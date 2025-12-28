import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Config = {
  region: process.env.AWS_REGION || "us-east-1",
  bucket: process.env.S3_EXPORT_BUCKET,
};

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: s3Config.region });
  }
  return s3Client;
}

export function isS3Configured(): boolean {
  return !!s3Config.bucket;
}

export async function uploadExport(
  sessionId: string,
  mp3Buffer: Buffer
): Promise<string> {
  if (!s3Config.bucket) {
    throw new Error("S3_EXPORT_BUCKET not configured");
  }

  const client = getS3Client();
  const key = `exports/${sessionId}.mp3`;

  await client.send(
    new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
      Body: mp3Buffer,
      ContentType: "audio/mpeg",
    })
  );

  return `https://${s3Config.bucket}.s3.${s3Config.region}.amazonaws.com/${key}`;
}
