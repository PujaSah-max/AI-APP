# S3 CORS Configuration Guide

This document explains how to configure CORS on your AWS S3 bucket to allow video file access from the Confluence Forge app.

## Why CORS is Needed

The Forge app fetches video files from S3 (`golpo-stage-private` bucket) via the backend resolver. While the backend can fetch files without CORS, proper CORS configuration ensures:
- Better error handling and debugging
- Future-proofing for direct frontend access
- Proper header exposure for content-type and content-length

## Steps to Configure S3 CORS

### 1. Access AWS S3 Console
1. Go to [AWS S3 Console](https://console.aws.amazon.com/s3/)
2. Select your bucket: `golpo-stage-private`

### 2. Navigate to CORS Settings
1. Click on the bucket name
2. Go to the **Permissions** tab
3. Scroll down to **Cross-origin resource sharing (CORS)**
4. Click **Edit**

### 3. Add CORS Configuration

**Option A: JSON Format (Recommended for AWS Console)**
```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "HEAD",
            "PUT"
        ],
        "AllowedOrigins": [
            "*"
        ],
        "ExposeHeaders": [
            "*"
        ]
    }
]
```

**Option B: XML Format**
```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>*</ExposeHeader>
  </CORSRule>
</CORSConfiguration>
```

### 4. Save Changes
- Click **Save changes**
- Wait 1-2 minutes for changes to propagate

## Production Security (Optional)

For production environments, consider restricting origins to Atlassian domains:

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "HEAD"
        ],
        "AllowedOrigins": [
            "https://*.atlassian.net",
            "https://*.atlassian.com"
        ],
        "ExposeHeaders": [
            "Content-Type",
            "Content-Length",
            "ETag"
        ]
    }
]
```

## Verification

After configuring CORS, test by:
1. Generating a video in the Confluence app
2. Attempting to download or play the video
3. Check browser console for CORS-related errors
4. Check Forge logs: `forge logs --follow`

## Troubleshooting

### Error: "CORS configuration issue"
- Verify CORS is saved in S3 bucket settings
- Wait 2-3 minutes after saving (propagation delay)
- Check that bucket name matches: `golpo-stage-private`
- Verify AllowedMethod includes "GET"

### Error: "403 Forbidden"
- Check bucket permissions (public read access or signed URLs)
- Verify the video file exists at the URL
- Check IAM policies if using signed URLs

### Still Not Working?
- Check Forge logs: `forge logs --follow`
- Verify the video URL is accessible: `curl -I <video-url>`
- Ensure bucket is in the same region as your Forge app (if applicable)

## Related Files

- Backend resolver: `src/index.js` - `fetchVideoFile` function
- Frontend: `static/hello-world/src/App.js` - Video download/playback logic
- Manifest: `manifest.yml` - External fetch permissions

