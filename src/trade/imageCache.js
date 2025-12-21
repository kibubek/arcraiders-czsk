const crypto = require("crypto");
const path = require("path");
const { S3Client, HeadObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

class TradeImageCache {
  constructor(options) {
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/+$/, "") || null;
    this.s3Client = options.s3Client || null;
    this.s3Bucket = options.s3Bucket || null;
    this.s3Prefix = options.s3Prefix?.replace(/^\/+|\/+$/g, "") || "trade-images";
  }

  async checkConnection() {
    if (!this.s3Client || !this.s3Bucket) return { ok: true, message: "s3 not configured" };
    try {
      const head = new HeadObjectCommand({
        Bucket: this.s3Bucket,
        Key: `${this.s3Prefix}/_healthcheck_${Date.now()}.ignore`,
      });
      await this.s3Client.send(head).catch(() => {});
      console.log("trade-image-cache: s3 connectivity ok", { bucket: this.s3Bucket, endpoint: this.s3Client.config.endpoint });
      return { ok: true };
    } catch (error) {
      console.warn("trade-image-cache: s3 connectivity failed", { bucket: this.s3Bucket, error });
      return { ok: false, error };
    }
  }

  async cacheAttachments(attachments, keyPrefix = "trade") {
    if (!Array.isArray(attachments) || attachments.length === 0) return attachments;

    const validBase =
      this.publicBaseUrl &&
      this.publicBaseUrl.startsWith("http") &&
      !this.publicBaseUrl.includes("<") &&
      !this.publicBaseUrl.includes("optional-prefix") &&
      !this.publicBaseUrl.includes("public-url-to-bucket");

    const results = [];
    for (const [index, attachment] of attachments.entries()) {
      if (!attachment?.url) {
        results.push(attachment);
        continue;
      }

      const fileName = this.buildFileName(attachment, keyPrefix, index);

      if (this.s3Client && this.s3Bucket && validBase) {
        const cleanBase = this.publicBaseUrl.replace(/\/+$/, "");
        const cleanPrefix = this.s3Prefix ? this.s3Prefix.replace(/^\/+|\/+$/g, "") : "";
        const key = cleanPrefix ? `${cleanPrefix}/${fileName}` : fileName;
        const uploaded = await this.uploadToS3(attachment.url, key);
        if (uploaded) {
          const publicUrl = `${cleanBase}/${cleanPrefix ? `${cleanPrefix}/` : ""}${encodeURIComponent(fileName)}`;
          console.log("trade-image-cache: cached to s3", { index, key, publicUrl, source: attachment.url });
          results.push({ ...attachment, cachedUrl: publicUrl });
          continue;
        }
        console.warn("trade-image-cache: s3 upload failed, using original", { index, source: attachment.url });
      } else if (!validBase && this.publicBaseUrl) {
        console.warn("trade-image-cache: invalid TRADE_IMAGE_BASE_URL, using original", { baseUrl: this.publicBaseUrl });
      }

      results.push(attachment);
    }

    return results;
  }

  buildFileName(attachment, keyPrefix, index) {
    const extFromName = this.getExtensionFromName(attachment.name);
    const extFromType = this.getExtensionFromType(attachment.contentType);
    const suffix = extFromName || extFromType || ".bin";
    const hash = crypto
      .createHash("sha1")
      .update(`${attachment.id || attachment.url || "att"}-${keyPrefix}-${index}`)
      .digest("hex")
      .slice(0, 12);
    return `${keyPrefix}-${hash}${suffix}`;
  }

  getExtensionFromName(name) {
    if (!name) return "";
    const ext = path.extname(name);
    return ext && ext.length <= 5 ? ext : "";
  }

  getExtensionFromType(contentType) {
    if (!contentType) return "";
    if (contentType.startsWith("image/")) {
      const subtype = contentType.split("/")[1];
      if (subtype) {
        return `.${subtype.replace("+xml", "").replace("+json", "")}`;
      }
    }
    return "";
  }

  async uploadToS3(sourceUrl, key) {
    try {
      const head = new HeadObjectCommand({ Bucket: this.s3Bucket, Key: key });
      const already = await this.s3Client.send(head).then(() => true).catch(() => false);
      if (already) return true;

      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        console.warn("trade-image-cache: s3 download failed", { sourceUrl, status: response.status });
        return false;
      }
      const arrayBuffer = await response.arrayBuffer();
      const put = new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
        Body: Buffer.from(arrayBuffer),
        ACL: "public-read",
      });
      await this.s3Client.send(put);
      return true;
    } catch (error) {
      console.warn("trade-image-cache: upload to s3 failed", { sourceUrl, key, error });
      return false;
    }
  }
}

function createTradeImageCacheFromEnv() {
  const enabled =
    process.env.TRADE_IMAGE_CACHE === "true" ||
    Boolean(process.env.TRADE_IMAGE_BASE_URL) ||
    Boolean(process.env.TRADE_IMAGE_S3_ENDPOINT);

  if (!enabled) return null;

  const baseUrl = process.env.TRADE_IMAGE_BASE_URL;

  let s3Client = null;
  let s3Bucket = null;
  let s3Prefix = process.env.TRADE_IMAGE_S3_PREFIX || "trade-images";

  if (process.env.TRADE_IMAGE_S3_ENDPOINT && process.env.TRADE_IMAGE_S3_BUCKET) {
    const region = process.env.TRADE_IMAGE_S3_REGION || "auto";
    const credentials =
      process.env.TRADE_IMAGE_S3_ACCESS_KEY && process.env.TRADE_IMAGE_S3_SECRET_KEY
        ? {
            accessKeyId: process.env.TRADE_IMAGE_S3_ACCESS_KEY,
            secretAccessKey: process.env.TRADE_IMAGE_S3_SECRET_KEY,
          }
        : undefined;

    s3Bucket = process.env.TRADE_IMAGE_S3_BUCKET;
    s3Client = new S3Client({
      endpoint: process.env.TRADE_IMAGE_S3_ENDPOINT,
      region,
      credentials,
      forcePathStyle: true,
    });

    if (!baseUrl) {
      console.warn(
        "trade-image-cache: TRADE_IMAGE_BASE_URL is required when using S3 uploads (public URL to the bucket/prefix)"
      );
    }
  }

  return new TradeImageCache({
    publicBaseUrl: baseUrl,
    s3Client,
    s3Bucket,
    s3Prefix,
  });
}

module.exports = {
  TradeImageCache,
  createTradeImageCacheFromEnv,
};
