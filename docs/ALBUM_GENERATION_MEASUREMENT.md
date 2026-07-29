# Album generation performance measurement

Initial creation returns `202 Accepted` after original files and minimum DB records are saved. Railway logs use abbreviated `album_id` and `job_id`; they never include file names, Storage paths, signed URLs, user data, prompts, or story text.

## Events

- `event=album_generation_request_received`
- `event=album_generation_original_upload_started` and `event=album_generation_original_upload_completed`
- `event=album_generation_photo_records_created` and `event=album_generation_accepted_response_ready` (`request_to_accepted_ms`, `upload_originals_ms`, `create_records_ms`)
- `event=album_generation_background_started` (`background_start_delay_ms`)
- `event=image_processing_completed` or `event=image_processing_completed_with_fallback`
- `event=story_generation_completed`
- `event=album_generation_completed` (`image_processing_ms`, `story_generation_ms`, `album_build_ms`, `total_generation_ms`)

Derivative failures are aggregated as `image_derivative_failed`. A usable original fallback is not an album-generation failure. Story and result-building failures are recorded as `story_generation_failed`, `album_build_failed`, and final `album_generation_failed` events.

## Post-deploy comparison

Use the same network and comparable image sizes. Record first-run and repeat-run measurements separately. Set `VITE_ALBUM_GENERATION_DEBUG=true` temporarily when browser timing logs are needed.

| Photos | Accepted | Image processing | Story | Album build | Total | Fallback |
| --- | --- | --- | --- | --- | --- | --- |
| 5 |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |
| 30 |  |  |  |  |  |  |

## Interpretation

- Long `request_to_accepted_ms`: inspect original upload, request-side photo preparation, and DB inserts.
- Long `image_processing_ms`: inspect Storage I/O, duplicate decode, and configured concurrency.
- Long `story_generation_ms`: inspect external request count and duplicate generation.
- Long `album_build_ms`: inspect result construction and repeated database reads.
- Fast Accepted but slow creation-screen entry: inspect frontend routing and browser timing logs.

Railway restart or deployment can interrupt BackgroundTasks. A processing job older than 30 minutes becomes retryable without re-uploading originals.
