import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export interface ContentAssetStore {
  get(objectKey: string): Promise<Uint8Array>
  ready(): Promise<void>
  put(objectKey: string, bytes: Uint8Array, mediaType: string, sha256: string): Promise<void>
}

export class S3ContentAssetStore implements ContentAssetStore {
  constructor(
    readonly client: S3Client,
    readonly bucket: string,
  ) {}

  async ready(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
  }

  async get(objectKey: string): Promise<Uint8Array> {
    let response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    }))
    if (!response.Body) throw new Error('Garage returned an empty object body')
    return response.Body.transformToByteArray()
  }

  async put(objectKey: string, bytes: Uint8Array, mediaType: string, sha256: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Body: bytes,
      Bucket: this.bucket,
      ContentType: mediaType,
      Key: objectKey,
      Metadata: { sha256 },
    }))
  }
}

export function createContentAssetStore(environment: NodeJS.ProcessEnv): S3ContentAssetStore {
  let endpoint = environment.S3_ENDPOINT
  let bucket = environment.S3_BUCKET
  let accessKeyId = environment.S3_ACCESS_KEY_ID
  let secretAccessKey = environment.S3_SECRET_ACCESS_KEY
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required')
  }
  return new S3ContentAssetStore(new S3Client({
    credentials: { accessKeyId, secretAccessKey },
    endpoint,
    forcePathStyle: true,
    region: environment.S3_REGION || 'garage',
  }), bucket)
}
