# CORS Verification Guide

This guide helps you verify that S3 CORS is properly configured and the video download/playback functionality works correctly.

## Step 1: Verify S3 CORS Configuration

### Check Current CORS Settings
1. Go to [AWS S3 Console](https://console.aws.amazon.com/s3/)
2. Select bucket: `golpo-stage-private`
3. Go to **Permissions** tab → **Cross-origin resource sharing (CORS)**
4. Verify the configuration matches:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "HEAD", "PUT"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["*"]
    }
]
```

### Test CORS with curl
Run this command to test if CORS headers are present:

```bash
curl -H "Origin: https://sahpuja.atlassian.net" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     -v \
     https://golpo-stage-private.s3.us-east-2.amazonaws.com/files/test.mp4
```

**Expected Response:**
- Status: `200 OK` or `204 No Content`
- Headers should include:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET, HEAD, PUT`
  - `Access-Control-Allow-Headers: *`

## Step 2: Test Video Generation

1. **Open Confluence Page**
   - Navigate to any Confluence page
   - Click the **•••** menu → **Golpo AI** (contentAction module)

2. **Generate a Video**
   - Fill in the description or use a quick action
   - Click **Generate Video** button
   - Select video specifications (duration, voice, language)
   - Click **✨ Generate Video**

3. **Monitor the Process**
   - Watch for the loading overlay with spinner
   - Check browser console (F12) for any errors
   - Wait for "Video generated successfully!" message

## Step 3: Test Video Playback

After video generation completes:

1. **Check Video Preview**
   - Video should appear in the success modal
   - Video player should be visible with controls

2. **Test Play Button**
   - Click **Play video** button
   - Video should start playing in the modal
   - If it fails, it should open in a new tab

3. **Check Console Logs**
   - Open browser DevTools (F12)
   - Look for:
     - `[GolpoAI] prepareVideoSource: ...` - Video source preparation
     - `[resolver:fetchVideoFile] Successfully fetched video` - Backend fetch success
     - No CORS errors

## Step 4: Test Video Download

1. **Click Download Button**
   - Click **Download video** button
   - File should download automatically
   - Filename: `golpo-video-{jobId}.mp4`

2. **If Download Fails**
   - Check browser console for errors
   - Look for: `[GolpoAI] Backend download fetch failed`
   - Check Forge logs: `forge logs --follow`

## Step 5: Check Forge Logs

Run this command to see backend resolver logs:

```bash
forge logs --follow
```

**Look for:**
- `[resolver:fetchVideoFile] Fetching video from: ...` - Video fetch initiated
- `[resolver:fetchVideoFile] CORS headers received: ...` - CORS headers logged
- `[resolver:fetchVideoFile] Successfully fetched video` - Success confirmation
- File size in MB logged

**Error Indicators:**
- `CORS configuration issue` - S3 CORS not configured
- `403 Forbidden` - Bucket permissions issue
- `Failed to fetch` - Network or CORS problem

## Step 6: Verify Browser Console

Open browser DevTools (F12) → Console tab:

**Success Indicators:**
- ✅ `[GolpoAI] Video ready!` - Video generation complete
- ✅ `[GolpoAI] prepareVideoSource: ...` - Video source prepared
- ✅ No CORS errors

**Error Indicators:**
- ❌ `Refused to connect because it violates CSP` - CSP issue (should use backend)
- ❌ `CORS policy` errors - S3 CORS not configured
- ❌ `Failed to fetch` - Network or CORS issue

## Troubleshooting

### Issue: "CORS configuration issue" in logs
**Solution:**
1. Verify S3 CORS is saved correctly
2. Wait 2-3 minutes after saving (propagation delay)
3. Check bucket name matches: `golpo-stage-private`
4. Verify AllowedMethod includes "GET"

### Issue: Video downloads but won't play
**Solution:**
1. Check video file is valid MP4: `file downloaded-video.mp4`
2. Verify blob URL is created: Check console for `blob:` URLs
3. Check video element: `<video>` tag should have `src` attribute

### Issue: "403 Forbidden" errors
**Solution:**
1. Check S3 bucket permissions (public read or signed URLs)
2. Verify video file exists at the URL
3. Check IAM policies if using signed URLs

### Issue: Download button does nothing
**Solution:**
1. Check if you're in `contentAction` module (not `contentBylineItem`)
2. Verify `videoPlayerUrl` is a blob URL
3. Check browser console for errors
4. Try opening video URL in new tab manually

## Quick Test Checklist

- [ ] S3 CORS configured with AllowedOrigin: *
- [ ] S3 CORS includes AllowedMethod: GET
- [ ] Video generation completes successfully
- [ ] Video preview appears in modal
- [ ] Play button works (plays in modal or opens new tab)
- [ ] Download button downloads file
- [ ] No CORS errors in browser console
- [ ] Backend logs show successful video fetch
- [ ] File size is logged correctly in backend

## Next Steps After Verification

If all tests pass:
- ✅ CORS is properly configured
- ✅ Video functionality is working
- ✅ Ready for production use

If tests fail:
- Review error messages in console/logs
- Check S3 CORS configuration again
- Verify bucket permissions
- Check Forge app permissions in manifest.yml

