# 11 — Real-World Designs Part 3

> Senior-level system designs that push the boundaries of scale, real-time coordination, financial correctness, and infrastructure observability — from streaming petabytes of video to processing millions of payments with zero data loss.

---

<!--
Topic: 50
Title: Design a Video Streaming Platform (YouTube/Netflix)
Section: 11 — Real-World Designs Part 3
Track: 0-to-100 Deep Mastery
Difficulty: Senior
Interview Weight: High
Prerequisites: Topics 1-3, 6, 10, 12, 15-17, 25
Next Topic: Topic 51 — Design a File Storage and Sync Service
Estimated Reading Time: 55-65 minutes
-->

## Topic 50: Design a Video Streaming Platform (YouTube/Netflix)

---

### Section 1 — Why This Design?

In February 2005, three former PayPal employees — Steve Chen, Chad Hurley, and Jawed Karim — registered the domain youtube.com. The legend says the idea crystallized after two separate frustrations: the difficulty of sharing video clips from a dinner party, and the near-impossibility of finding footage of Janet Jackson's Super Bowl halftime incident online. On April 23, 2005, Karim uploaded the first-ever YouTube video, "Me at the zoo," an 18-second clip shot at the San Diego Zoo. Within a year, the site was serving 100 million video views per day, and in October 2006, Google acquired it for $1.65 billion — a sum that seemed outlandish at the time but now looks like one of the greatest bargains in tech history. Today YouTube serves over 2 billion logged-in users per month, with over 500 hours of video uploaded every single minute.

Meanwhile, Netflix had been running a successful DVD-by-mail business since 1997 under founder Reed Hastings and co-founder Marc Randolph. But Hastings always viewed physical media as a transitional phase. In January 2007, Netflix launched its streaming service, initially offering just 1,000 titles that subscribers could watch through a web browser. The pivot was not without risk — it cannibalized their own profitable DVD business and required massive infrastructure investment. But the bet paid off spectacularly. Netflix grew from 7.5 million subscribers in 2007 to over 260 million globally by 2025, fundamentally reshaping the entertainment industry and spawning the era of binge-watching. Their technological innovations — from adaptive bitrate streaming to the Open Connect CDN — became industry benchmarks.

The reason this design problem carries such high interview weight is that video streaming touches nearly every pillar of distributed systems engineering. Video data is enormous — a single hour of 4K video at reasonable quality consumes roughly 7 GB of storage. Multiply that by hundreds of millions of videos, each transcoded into a dozen resolution and codec combinations, and you face storage challenges measured in exabytes. Delivering that content to a billion daily users scattered across every continent demands a content delivery network of extraordinary sophistication. The upload pipeline alone requires chunked uploads, resumable transfers, transcoding queues, content moderation, and metadata extraction. The playback pipeline demands adaptive bitrate logic, buffer management, and sub-second startup times. The recommendation engine needs to process petabytes of watch history to surface relevant content. And all of this must work seamlessly whether the viewer is on a fiber connection in Seoul or a 3G network in rural India. Cisco's annual internet report consistently shows that video traffic accounts for over 80% of all consumer internet traffic — designing the systems that carry that traffic is one of the most consequential engineering challenges of our era.

In a system design interview, this question lets the interviewer probe your understanding of storage hierarchies, CDN architecture, encoding pipelines, database modeling, recommendation systems, and cost optimization — all within a single conversation. The breadth of the problem means every candidate reveals their strengths and blind spots. Strong candidates demonstrate the ability to reason about trade-offs at every layer: which codec to use for which device, when to pre-transcode versus transcode on demand, how to balance CDN cache hit ratios against storage costs, and how to architect a recommendation system that is both real-time and computationally tractable.

---

### Section 2 — Requirements Gathering

Before drawing a single architecture box, a strong candidate pauses to clarify requirements. Video streaming platforms span an enormous design space — a system optimized for short user-generated clips (YouTube) differs significantly from one optimized for long-form professionally produced content (Netflix). The interviewer expects you to ask clarifying questions and then commit to a coherent set of requirements.

**Functional Requirements:**

The core user-facing capabilities we must support are: (1) Video Upload — creators must be able to upload videos of varying sizes (from a 15-second clip to a 4-hour lecture), with support for resumable uploads so that a failed connection does not force a complete restart. (2) Video Streaming — viewers must be able to watch videos with adaptive bitrate streaming, meaning the quality adjusts dynamically based on network conditions and device capabilities. (3) Search — users must be able to find videos by title, description, tags, channel name, and transcript content. (4) Recommendations — the platform must surface relevant videos on the home feed and in the "up next" sidebar, based on watch history, preferences, and trending content. (5) Social Interactions — users can like/dislike videos, post comments, subscribe to channels, and share videos. (6) Channel Management — creators can manage their channel, view analytics, organize videos into playlists, and monetize content.

**Non-Functional Requirements:**

The system must deliver low buffering and fast startup times — industry benchmarks target a time-to-first-byte under 200ms and rebuffering ratios below 1%. It must be globally available with consistent performance whether the user is in New York, Nairobi, or New Delhi. It must support a wide range of devices and resolutions, from 240p on feature phones to 4K HDR on smart TVs. The upload pipeline must be reliable and eventually consistent — a video uploaded successfully must eventually appear on the platform, but we can tolerate a processing delay of several minutes. The system must handle content at massive scale while keeping infrastructure costs manageable, which means intelligent tiering of storage and aggressive CDN caching.

**Back-of-Envelope Estimation:**

Let us ground the design with concrete numbers. We will target a YouTube-scale platform.

Users and activity:
- 2 billion monthly active users (MAU)
- 1 billion daily active users (DAU)
- Average session: 40 minutes per day
- Average video length: 5 minutes
- Average videos watched per user per day: 8
- Total video views per day: 1B x 8 = 8 billion views/day
- Views per second: 8B / 86,400 ~ 92,600 views/second (peak: ~200K/s)

Uploads:
- 500 hours of video uploaded per minute = 30,000 hours/hour = 720,000 hours/day
- At average 5 minutes per video: 720,000 x 60 / 5 = 8.64 million videos/day
- Approximate to ~5-9 million uploads/day

Storage calculation (per video):
- Raw upload (1080p, H.264): ~150 MB per minute of video
- Average 5-minute video raw: 750 MB
- Transcoded outputs (6 resolutions x 2 codecs = 12 variants):
  - 4K (2160p): ~800 MB
  - 1080p: ~400 MB
  - 720p: ~250 MB
  - 480p: ~150 MB
  - 360p: ~80 MB
  - 240p: ~40 MB
  - Total per codec: ~1,720 MB
  - Two codecs (H.264 + VP9): ~3,440 MB
- Thumbnails, subtitles, metadata: ~10 MB
- Total storage per video (including raw): ~4,200 MB ~ 4.2 GB
- Daily new storage: 5M videos x 4.2 GB = 21 PB/day
- Annual new storage: ~7.6 EB/year

Bandwidth:
- Average streaming bitrate: ~5 Mbps (blended across resolutions)
- Concurrent viewers (peak): assume 300 million simultaneous streams
- Peak bandwidth: 300M x 5 Mbps = 1.5 Petabits/second = 1,500 Tbps
- Daily data served: 1B users x 40 min x 5 Mbps = 1B x 2,400s x 5Mbps
  = 1B x 12,000 Mb = 12 exabits/day = 1.5 EB/day

CDN requirements:
- To serve 1,500 Tbps at peak, with average edge server capacity of 100 Gbps:
  - Minimum edge servers: 1,500,000 Tbps / 0.1 Tbps = 15,000 edge servers
  - With redundancy and geographic distribution: ~20,000-50,000 edge servers globally

These numbers reveal why video streaming is one of the hardest infrastructure challenges in computing. The storage grows by petabytes daily, the bandwidth rivals the capacity of entire national networks, and the CDN must span thousands of points of presence worldwide.

---

### Section 3 — High-Level Architecture

The architecture of a video streaming platform divides cleanly into two major pipelines — the upload pipeline and the streaming pipeline — supported by a constellation of auxiliary services for metadata, search, recommendations, and user management.

The **upload pipeline** handles the journey of a video from the creator's device to a globally distributed, playback-ready state. The creator uploads the raw file through a chunked upload service. Once all chunks are reassembled, the video enters a transcoding pipeline that produces multiple resolution and codec variants. The transcoded segments are stored in object storage and then distributed to CDN edge nodes. Concurrently, the system extracts metadata, generates thumbnails, runs content moderation checks (automated and, when flagged, human review), and updates the search index.

The **streaming pipeline** handles the journey from a viewer's play request to pixels on their screen. The client player requests a manifest file (HLS or DASH) that lists available quality levels. Based on current network conditions, the player selects an appropriate bitrate and begins requesting video segments from the nearest CDN edge server. If the edge has the segment cached, it serves immediately. If not, the request falls back to a regional CDN node, then to the origin storage. The player continuously monitors throughput and adjusts quality up or down to minimize buffering.

Here is the high-level architecture:

```
                            +------------------+
                            |   Load Balancer  |
                            +--------+---------+
                                     |
                     +---------------+---------------+
                     |                               |
              +------+------+                 +------+------+
              | Upload API  |                 | Stream API  |
              | Service     |                 | Service     |
              +------+------+                 +------+------+
                     |                               |
          +----------+----------+             +------+------+
          |                     |             |  CDN Edge   |
    +-----+------+    +---------+---+         |  Network    |
    | Chunk Store|    | Transcode   |         +------+------+
    | (Temp S3)  |    | Queue (SQS/ |                |
    +-----+------+    | Kafka)      |         +------+------+
          |           +------+------+         | Origin      |
          |                  |                | Storage     |
          |           +------+------+         | (S3/GCS)   |
          |           | Transcode   |         +-------------+
          |           | Workers     |
          |           | (FFmpeg     |
          |           |  cluster)   |
          |           +------+------+
          |                  |
          |           +------+------+
          +---------->| Segment     |
                      | Storage     |
                      | (S3/GCS)    |
                      +------+------+
                             |
                      +------+------+
                      | CDN Push /  |
                      | Invalidation|
                      +-------------+

    +-------------------+    +--------------------+    +------------------+
    | Video Metadata    |    | Search Service     |    | Recommendation   |
    | Service           |    | (Elasticsearch)    |    | Engine           |
    | (PostgreSQL +     |    +--------------------+    | (ML Pipeline)    |
    |  Redis Cache)     |                              +------------------+
    +-------------------+

    +-------------------+    +--------------------+    +------------------+
    | User Service      |    | Comment / Social   |    | Analytics        |
    | (Auth, Profiles)  |    | Service            |    | Service          |
    +-------------------+    +--------------------+    +------------------+
```

Each service communicates asynchronously where possible. The upload API enqueues transcoding jobs rather than waiting synchronously. The metadata service is updated once transcoding completes, triggering downstream updates to the search index and recommendation input. The streaming path is optimized for latency — the CDN serves the overwhelming majority of requests without touching origin, and the manifest and segment requests follow deterministic URL patterns that are highly cacheable.

The separation between upload and streaming pipelines is deliberate. Upload traffic is bursty, CPU-intensive (transcoding), and latency-tolerant (creators accept a processing delay). Streaming traffic is steady-state, I/O-intensive, and latency-critical (viewers will not tolerate buffering). By isolating these workloads, we can scale and optimize them independently, using spot instances for transcoding workers and reserved capacity for streaming edge nodes.

---

### Section 4 — Deep Dive: Video Processing Pipeline

The video processing pipeline is the backbone of any streaming platform. It transforms a raw upload into a set of optimized, globally distributable assets. Each stage presents distinct engineering challenges.

**Chunked and Resumable Uploads**

A naive upload mechanism that accepts an entire video file in a single HTTP request would fail catastrophically for large files. A 2-hour 4K video might be 50 GB — transferring that over a consumer connection could take hours, and any network interruption would require starting over. Instead, the upload service implements chunked uploads following a protocol similar to the TUS resumable upload protocol or Google's resumable upload API.

The process works as follows: the client first sends an initialization request containing the file metadata (name, size, MIME type, checksum). The server responds with an upload URI and a unique upload ID. The client then splits the file into chunks (typically 5-10 MB each) and uploads them sequentially or in parallel, each tagged with its byte range. The server tracks which chunks have been received. If the connection drops, the client queries the server for the last successfully received byte offset and resumes from there. Once all chunks are received, the server verifies the complete file checksum, assembles the chunks, and enqueues the video for processing.

This design requires a temporary chunk storage layer (often a dedicated S3 bucket with lifecycle policies that automatically clean up incomplete uploads after 24-48 hours) and a stateful upload tracking service (backed by Redis or DynamoDB for fast lookups). The upload endpoint must be idempotent — re-uploading the same chunk must not corrupt the file.

**Transcoding**

Once the raw video is assembled, it enters the transcoding pipeline. Transcoding is the process of converting the video from its source format into multiple output formats optimized for different devices, resolutions, and network conditions. This is by far the most computationally expensive operation in the pipeline.

The transcoding system uses a job queue architecture. The upload service publishes a message to a queue (Kafka, SQS, or RabbitMQ) containing the video ID and location of the raw file. A fleet of transcoding workers — often running on GPU-equipped instances for hardware-accelerated encoding — picks up jobs from the queue. Each worker uses FFmpeg (or a commercial encoder like AWS Elemental MediaConvert) to produce the required outputs.

For each video, the system typically generates:

- Multiple resolutions: 2160p (4K), 1440p, 1080p, 720p, 480p, 360p, 240p
- Multiple codecs: H.264 (AVC) for maximum compatibility, VP9 for better compression on Chrome/Android, H.265 (HEVC) for Apple devices, and increasingly AV1 for next-generation compression efficiency
- Multiple segment lengths: typically 2-6 second segments for adaptive bitrate streaming

The codec landscape deserves attention because it directly impacts both quality and cost. H.264 is the universal baseline — every device and browser supports it, but it produces the largest files. VP9 achieves roughly 30-50% better compression than H.264 at equivalent quality and is supported by Chrome, Firefox, and Android. H.265 achieves similar compression gains and is dominant in the Apple ecosystem, but its licensing complexity has slowed adoption. AV1, developed by the Alliance for Open Media (which includes Google, Netflix, Amazon, and others), achieves 20-30% better compression than VP9 with no licensing fees, but encoding is significantly slower and more CPU-intensive. Netflix uses AV1 for most of its catalog; YouTube has been progressively rolling out AV1 for popular content.

A single 10-minute video transcoded into 7 resolutions and 3 codecs produces 21 variants. Each variant is segmented into 4-second chunks, yielding approximately 150 segments per variant, or over 3,000 total segments. This is why transcoding at YouTube's scale (500 hours per minute) requires tens of thousands of transcoding workers running continuously.

**Adaptive Bitrate Streaming (ABR)**

Adaptive bitrate streaming is the technique that allows video quality to adjust in real time based on the viewer's network conditions. The two dominant protocols are HLS (HTTP Live Streaming, developed by Apple) and DASH (Dynamic Adaptive Streaming over HTTP, an open standard).

Both work similarly: the video is split into small segments (typically 2-6 seconds), and a manifest file lists all available quality levels along with the URLs of their segments. The client player downloads the manifest, estimates available bandwidth, and requests segments at the appropriate quality level. If bandwidth drops, the player switches to a lower quality for the next segment. If bandwidth improves, it ramps up. The transition happens at segment boundaries, so there are no visual glitches — just a change in resolution.

An HLS master playlist might look like:

```
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480
480p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=14000000,RESOLUTION=3840x2160
2160p/playlist.m3u8
```

Each resolution's playlist then references the individual segment files. The client downloads one segment at a time, measuring how quickly each download completes to estimate current throughput.

**Thumbnail Generation**

As part of the processing pipeline, the system generates thumbnails at multiple points in the video. These are used for the video preview cards on the home page, for the scrubbing preview that appears when hovering over the seek bar, and for the video's poster frame. Typically, the system extracts a frame every few seconds (Netflix extracts one per second) and composites them into sprite sheets for efficient delivery. The creator can also upload a custom thumbnail.

**Content Moderation**

Every uploaded video passes through an automated content moderation pipeline before it becomes publicly available. This pipeline uses machine learning models to detect nudity, violence, hate speech (via audio transcription and NLP), copyright violations (via audio fingerprinting like Content ID and visual fingerprinting), and other policy-violating content. Videos that pass all automated checks are published immediately. Videos that trigger moderate-confidence flags are queued for human review. Videos that trigger high-confidence violations are blocked and the uploader is notified. This pipeline adds latency to the upload-to-publish time but is essential for platform safety and legal compliance.

---

### Section 5 — Storage Architecture

Storage is the largest cost center and one of the most critical architectural decisions for a video streaming platform. The volume of data is staggering — YouTube stores an estimated 1 exabyte or more of video content — and the access patterns are highly varied, from viral videos viewed millions of times per hour to long-tail content accessed once a month.

**Raw Video Storage**

When a video is first uploaded, the raw file is stored in a highly durable object store such as Amazon S3, Google Cloud Storage, or an equivalent private infrastructure. This raw file serves as the "source of truth" — if new codecs emerge or higher-quality transcoding algorithms are developed, the platform can re-transcode from the original. YouTube, for example, periodically re-encodes its most popular videos as encoder technology improves. Raw files are stored in a durable storage tier (11 nines of durability) but may be migrated to infrequent-access tiers after the initial transcoding is complete, since they are rarely read.

**Transcoded Segment Storage**

The transcoded segments — the actual files served to viewers — are stored in a separate object store optimized for high-throughput reads. Each segment is typically 2-6 seconds of video at a specific resolution and codec, stored as a small file (100 KB to 5 MB depending on bitrate and segment duration). The naming convention is deterministic and hierarchical, enabling efficient CDN caching:

```
/videos/{video_id}/{codec}/{resolution}/segment_{number}.ts
/videos/abc123/h264/1080p/segment_042.ts
/videos/abc123/vp9/720p/segment_042.webm
```

This deterministic URL structure is critical because CDN cache keys are typically derived from the URL. By ensuring that the same segment always maps to the same URL, we maximize cache hit ratios across the CDN.

**Tiered Storage**

Not all videos are created equal in terms of access frequency. A newly uploaded video from a popular creator might receive millions of views in its first 48 hours, while an obscure tutorial uploaded five years ago might get a handful of views per month. Storing both at the same storage tier would be wasteful. The platform implements a tiered storage strategy:

- **Hot tier** (SSD-backed, replicated across regions): Videos uploaded within the last 7 days, videos trending in any region, and the top 1% most-viewed videos. These are also aggressively pushed to CDN edge nodes.
- **Warm tier** (HDD-backed, single region with cross-region replication): Videos with moderate access frequency. These are cached at CDN on demand and may experience slightly higher first-view latency.
- **Cold tier** (archival storage like S3 Glacier or Google Coldline): Videos with very low access frequency. These are not cached at CDN, and a view request triggers a retrieval that may add several seconds of latency. The platform might show a "loading" indicator while the content is retrieved.

A background analytics job continuously monitors view counts and access patterns, migrating videos between tiers. The migration is based on a time-decayed access frequency score — a video's score decreases over time unless sustained by ongoing views.

**Deduplication**

At the scale of millions of uploads per day, a significant fraction are duplicates — the same viral clip re-uploaded thousands of times, or slight variations of existing content. Deduplication saves substantial storage costs and also supports copyright enforcement. The system computes perceptual hashes (like pHash or VideoHash) of each uploaded video and compares them against a database of existing hashes. If a near-exact match is found, the system can either reject the upload, link it to the existing transcoded assets (saving storage), or flag it for copyright review.

**Storage Cost Optimization**

At YouTube's scale, even small optimizations have enormous financial impact. Key strategies include: (1) Encoding efficiency — using newer codecs like AV1 produces smaller files, directly reducing storage and bandwidth costs. (2) Popularity-based resolution — not every video needs a 4K variant. If a video has fewer than 1,000 views, the system might only generate 360p, 480p, and 720p, adding higher resolutions only if demand warrants. (3) Segment deduplication — for videos with static portions (like a talking-head lecture with a still background), consecutive identical segments can be deduplicated. (4) Compression of cold storage — raw files in cold storage can be compressed with high-ratio algorithms since retrieval speed is not a priority.

---

### Section 6 — Content Delivery

The content delivery network is what makes or breaks the viewer experience. A perfectly transcoded video stored in a single data center is useless if it takes 10 seconds to buffer for a viewer 10,000 miles away. The CDN's job is to place copies of video content as close to viewers as possible, minimizing latency and maximizing throughput.

**CDN Architecture**

A video streaming CDN operates as a multi-tier cache hierarchy:

```
Viewer -> ISP Edge Server -> Regional PoP -> Origin Shield -> Origin Storage
  |           |                    |              |               |
  |    (Netflix Open       (Major metro     (Single         (S3/GCS in
  |     Connect box         data centers)    aggregation      2-3 core
  |     in ISP's                             point to         regions)
  |     data center)                         protect
  |                                          origin)
  +-- Fastest available path wins
```

At the bottom of the hierarchy is the **origin storage** — the S3 or GCS buckets where all transcoded segments live. Sitting in front of origin is an **origin shield**, a caching layer that absorbs cache misses from all regional nodes, ensuring that origin only serves each segment once even if dozens of regional nodes request it simultaneously. **Regional Points of Presence (PoPs)** are large caching clusters in major metropolitan areas (think 50-200 global locations). Finally, **edge servers** push content even closer to users, sometimes directly into ISP data centers.

**Netflix Open Connect**

Netflix pioneered an innovative CDN approach called Open Connect. Rather than relying entirely on third-party CDN providers, Netflix deploys custom hardware appliances — called Open Connect Appliances (OCAs) — directly inside ISP data centers and internet exchange points worldwide. Each OCA is a server with 100+ TB of storage and 100 Gbps+ of network capacity. During off-peak hours (typically early morning), Netflix proactively fills these appliances with content predicted to be popular in that region the following day. When a subscriber hits play, the content is served from the OCA sitting inside their own ISP's network — eliminating internet transit entirely and providing a nearly local experience.

This model benefits everyone: Netflix reduces its bandwidth costs, ISPs reduce their peering traffic, and subscribers get better quality. As of recent reports, Netflix has deployed over 17,000 OCAs across 6,000+ locations in 175+ countries. Over 95% of Netflix traffic is served from within the ISP's own network.

**YouTube's Edge Network**

YouTube, backed by Google's infrastructure, takes a different but equally effective approach. Google operates one of the world's largest private networks, with Points of Presence in over 200 countries and territories. Google's Global Cache (GGC) nodes are deployed in ISPs similar to Netflix's OCAs, specifically to cache YouTube and other Google content. Additionally, YouTube leverages Google's backbone network — a private fiber-optic network spanning undersea cables and terrestrial links — to move content between data centers with predictable low latency, insulating viewers from public internet congestion.

**Cache Hit Optimization**

The CDN's effectiveness is measured by its cache hit ratio — the percentage of requests served from cache without touching origin. For a video platform, the hit ratio varies dramatically by content popularity. The top 1% of videos (viral content, trending, new releases from popular creators) might have 99%+ cache hit ratios because they are cached everywhere. Long-tail content (the bottom 50% of videos by view count) might have hit ratios below 50%, meaning most views trigger a cache miss. The blended cache hit ratio for a well-optimized video CDN is typically 90-95%.

Strategies to improve hit ratios include: (1) Predictive pre-fetching — when a user starts watching a video, pre-fetch the next several segments before they are needed, and also pre-fetch the first segments of videos likely to be watched next (based on recommendation data). (2) Content popularity prediction — using machine learning to predict which newly uploaded videos will go viral, and proactively pushing them to edge caches before demand spikes. (3) Regional popularity analysis — a K-pop music video might be wildly popular in South Korea but obscure in Brazil; the CDN should cache aggressively in regions where demand exists rather than treating the world uniformly.

**Adaptive Bitrate Switching on the Client**

The client-side player is a sophisticated piece of software that continuously optimizes the viewing experience. It maintains a buffer (typically 30-60 seconds of video ahead of the current playback position) and monitors the download speed of each segment. The ABR algorithm uses these measurements to predict future throughput and select the appropriate quality level for the next segment.

Modern ABR algorithms are more nuanced than simple throughput-based switching. Netflix's player, for example, uses a buffer-based algorithm that also considers the current buffer level — if the buffer is full (60 seconds ahead), it will aggressively upgrade quality even if throughput measurements are uncertain, because there is ample time to recover if the higher quality is unsustainable. If the buffer is dangerously low (under 10 seconds), it will aggressively downgrade to prevent rebuffering, even if measured throughput suggests higher quality might work. YouTube's player employs similar heuristics, also incorporating device capabilities (no point requesting 4K on a 720p phone screen) and user preferences.

---

### Section 7 — Database Design

The database layer of a video streaming platform must handle vastly different data types and access patterns — structured metadata, high-velocity counters, full-text search indices, and massive analytics tables. No single database technology can optimally serve all these needs, so the design employs a polyglot persistence strategy.

**Video Metadata (PostgreSQL or MySQL)**

The core video metadata lives in a relational database for strong consistency guarantees. Here is a representative schema:

```sql
-- Core video table
CREATE TABLE videos (
    video_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id      UUID NOT NULL REFERENCES channels(channel_id),
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    duration_sec    INTEGER NOT NULL,
    upload_status   VARCHAR(20) DEFAULT 'processing',
        -- 'processing', 'ready', 'failed', 'removed'
    visibility      VARCHAR(20) DEFAULT 'public',
        -- 'public', 'unlisted', 'private'
    category_id     INTEGER REFERENCES categories(category_id),
    language        VARCHAR(10),
    raw_file_url    TEXT NOT NULL,
    manifest_url    TEXT,              -- HLS/DASH manifest URL
    thumbnail_url   TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    published_at    TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_videos_channel ON videos(channel_id, created_at DESC);
CREATE INDEX idx_videos_published ON videos(published_at DESC)
    WHERE upload_status = 'ready' AND visibility = 'public';

-- Channel / creator table
CREATE TABLE channels (
    channel_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id),
    channel_name    VARCHAR(200) NOT NULL,
    description     TEXT,
    avatar_url      TEXT,
    banner_url      TEXT,
    subscriber_count BIGINT DEFAULT 0,
    total_views     BIGINT DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- User table
CREATE TABLE users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    username        VARCHAR(100) UNIQUE NOT NULL,
    display_name    VARCHAR(200),
    password_hash   TEXT NOT NULL,
    avatar_url      TEXT,
    country         VARCHAR(2),
    created_at      TIMESTAMP DEFAULT NOW(),
    last_login_at   TIMESTAMP
);

-- Subscription relationship
CREATE TABLE subscriptions (
    user_id         UUID REFERENCES users(user_id),
    channel_id      UUID REFERENCES channels(channel_id),
    subscribed_at   TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

-- Comments (potentially sharded by video_id)
CREATE TABLE comments (
    comment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID NOT NULL REFERENCES videos(video_id),
    user_id         UUID NOT NULL REFERENCES users(user_id),
    parent_id       UUID REFERENCES comments(comment_id),  -- for replies
    content         TEXT NOT NULL,
    like_count      INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_comments_video ON comments(video_id, created_at DESC);
```

At YouTube's scale, these tables would be sharded — videos by video_id (or channel_id for channel-centric queries), comments by video_id (since comments are almost always queried in the context of a specific video), and subscriptions by user_id (for generating subscription feeds).

**View Counts and Real-Time Analytics (NoSQL)**

View counts, like counts, and other rapidly changing counters are a poor fit for relational databases due to the extreme write throughput required. A single viral video might receive thousands of view increments per second. These counters are typically stored in a high-throughput key-value store like Redis (for real-time counts) with periodic flushing to a more durable store like Cassandra or DynamoDB.

The view counting system must also handle deduplication (not counting the same user's repeated views within a short window), bot detection, and eventual consistency (the displayed count does not need to be perfectly real-time — YouTube famously freezes counts at "301 views" for verification). A common pattern is to buffer view events in Kafka, process them in near-real-time with a stream processing engine like Flink or Spark Streaming, deduplicate, and then update the counter store and analytics tables.

**Watch History**

A user's watch history is a time-series dataset — every video they have started watching, how much they watched (watch percentage), and when. This data is stored in a wide-column store like Cassandra or BigTable, with the partition key being the user_id and the clustering key being the timestamp. This allows efficient queries like "get the last 100 videos watched by user X" while supporting the enormous write throughput of a billion daily active users each generating multiple watch events per session.

**Search Index (Elasticsearch)**

Video search requires full-text search capabilities with relevance ranking, faceting, auto-complete, and fuzzy matching. Elasticsearch (or its managed equivalent, Amazon OpenSearch) provides all of these. The search index is populated by a separate indexing pipeline that consumes events from the video metadata service. Each video document in the index includes the title, description, tags, channel name, auto-generated transcript (from speech-to-text), category, language, view count, and recency — all of which are used to compute relevance scores.

The search ranking algorithm balances textual relevance (how well the query matches the video's metadata) with engagement signals (view count, like ratio, click-through rate, watch time) and freshness (recently uploaded content gets a boost). This is similar to how Google's web search balances content relevance with PageRank.

---

### Section 8 — Recommendation System

The recommendation engine is arguably the most valuable component of a video streaming platform from a business perspective. YouTube reported that over 70% of watch time comes from recommended videos, not from direct search. Netflix's recommendation system is estimated to save the company over $1 billion per year in subscriber retention by helping users find content they enjoy before they get frustrated and cancel. Designing this system well is therefore a high-impact engineering challenge.

**Collaborative Filtering**

Collaborative filtering operates on the principle that users who have watched and enjoyed similar videos in the past will likely enjoy similar videos in the future. There are two main variants:

User-based collaborative filtering finds users similar to you (based on overlapping watch history and ratings) and recommends videos they watched that you have not. Item-based collaborative filtering finds videos similar to the one you just watched (based on co-occurrence patterns — users who watched video A also watched video B) and recommends those. In practice, item-based filtering tends to be more stable and scalable because the item catalog changes more slowly than user behavior.

At scale, collaborative filtering is implemented using matrix factorization techniques. The user-video interaction matrix (where each cell represents whether user U watched video V, and perhaps how much they watched) is factored into two lower-dimensional matrices — one representing users in latent feature space and one representing videos. The dot product of a user vector and a video vector predicts the user's interest in that video. These factorizations are computed as batch jobs over the entire interaction matrix, typically using distributed frameworks like Spark MLlib, and the resulting vectors are stored for real-time serving.

**Content-Based Filtering**

Content-based filtering recommends videos based on their attributes rather than collective user behavior. If you watch a lot of Python programming tutorials, the system recommends other Python tutorials based on title, description, tags, category, and even visual and audio features extracted by deep learning models. Content-based filtering is especially useful for the cold-start problem — a newly uploaded video has no interaction history, so collaborative filtering cannot recommend it, but content-based filtering can compare its attributes to videos the user has previously enjoyed.

Modern platforms use deep neural networks to extract rich feature representations. The video's visual frames are processed through a convolutional neural network to extract visual features. The audio is transcribed and processed through NLP models. The title and description are embedded using language models. All these features are combined into a dense vector representation that captures the "essence" of the video.

**Hybrid Approach and Two-Stage Architecture**

In practice, platforms like YouTube and Netflix use a hybrid approach with a two-stage architecture:

Stage 1 — Candidate Generation: This stage narrows the full video catalog (hundreds of millions of videos) down to a manageable set of candidates (hundreds to low thousands). Multiple candidate generators run in parallel — one based on collaborative filtering, one based on content similarity to recently watched videos, one based on trending content in the user's region, one based on subscription feed, and so on. The outputs are merged and deduplicated.

Stage 2 — Ranking: A more computationally expensive ranking model scores each candidate based on a rich set of features — user demographics, device type, time of day, watch history, the candidate video's quality signals, and predicted engagement (will the user click? will they watch more than 50%? will they like?). The top-ranked videos are returned to the client for display.

This two-stage architecture is a fundamental pattern because running the expensive ranking model over the entire catalog would be computationally infeasible in real time.

**Real-Time vs Batch Generation**

Recommendations are generated through a combination of batch and real-time processing. The heavy matrix factorization and model training happen as batch jobs (daily or weekly) using large-scale compute clusters. But the candidate generation and ranking at serving time are real-time — they incorporate the user's most recent actions (what they just watched, what they just searched for) to provide immediately relevant suggestions. This is achieved by maintaining user feature stores (like Redis or a feature store service) that are updated in near-real-time as the user interacts with the platform.

**A/B Testing**

Recommendation algorithms are continuously improved through rigorous A/B testing. The platform runs dozens of concurrent experiments, each directing a small percentage of users to a variant recommendation algorithm. Key metrics — watch time per session, click-through rate on recommendations, subscriber retention, and user satisfaction surveys — are measured with statistical rigor. Only algorithms that demonstrate statistically significant improvements are promoted to full production. Netflix has described its culture of "scientifically-informed" product decisions, where nearly every change to the recommendation system goes through an A/B test, sometimes for weeks, before roll-out.

---

### Section 9 — Trade-Offs and Design Decisions

Every design decision in a video streaming platform involves trade-offs. The ability to articulate these trade-offs clearly is what separates senior candidates from junior ones in interviews.

**Push vs Pull CDN**

In a pull CDN, edge servers fetch content from origin only when a viewer requests it and the edge does not have it cached. In a push CDN, the platform proactively pushes content to edge servers before any viewer requests it. Netflix's Open Connect is essentially a push CDN — content is pre-positioned overnight during off-peak hours. YouTube uses a hybrid approach — popular content is proactively pushed, while long-tail content is pulled on demand.

The trade-off is cost versus latency. Push CDN pre-positions content, eliminating first-viewer latency, but wastes storage and bandwidth on content that may never be requested from that edge. Pull CDN wastes no storage on unrequested content but imposes higher latency on the first viewer (the "cold cache" problem). For a platform with predictable content (Netflix's curated catalog, where viewing patterns are analyzable), push is effective. For a platform with unpredictable, long-tail content (YouTube's user-generated catalog), pull with selective push for popular content is more pragmatic.

**Codec Choice: Compatibility vs Compression**

H.264 works everywhere but produces large files. AV1 produces files 40-50% smaller but requires significant encoding compute and is not supported by older devices. The decision of which codecs to support and when to use each one has enormous financial implications. If encoding into AV1 saves 40% on bandwidth costs but increases encoding compute costs by 300%, the break-even point depends on how many times the video will be watched. For a Netflix original that will be viewed millions of times, the compute investment in AV1 encoding pays for itself almost immediately. For a YouTube video that gets 50 views, encoding into AV1 in addition to H.264 wastes compute with negligible bandwidth savings. This leads to a popularity-based codec strategy: encode everything into H.264 as a baseline, and selectively encode into AV1/VP9 for content that exceeds a view count threshold.

**Live vs On-Demand Architecture**

Live streaming (Twitch, YouTube Live) and video-on-demand (Netflix, standard YouTube) share some infrastructure but differ in fundamental ways. On-demand content is pre-transcoded and cached; live content must be transcoded in real time with end-to-end latency targets of 2-10 seconds. On-demand content can be split into segments at optimal keyframe boundaries; live content must be segmented in real time. On-demand CDN caching is highly effective because the same segments are requested repeatedly; live CDN caching is less effective because each segment is new and may only be requested for a short window. In interviews, clarify whether you are designing for on-demand, live, or both — it significantly affects the architecture.

**Pre-Transcoding All Resolutions vs On-Demand Transcoding**

Pre-transcoding every video into every resolution and codec is the default approach, but it is wasteful for the vast majority of content. An alternative is "just-in-time" transcoding — encode only the most common resolutions (480p and 720p) upfront, and transcode additional resolutions only if a viewer requests them. The first viewer at 4K experiences a delay while the system transcodes, but subsequent viewers get the cached result. This saves enormous storage and compute costs for long-tail content at the expense of occasional latency spikes. YouTube reportedly uses a version of this approach for less popular content.

**Centralized vs Distributed Transcoding**

Transcoding can be performed in a few large centralized clusters or distributed across many smaller clusters near the upload ingestion points. Centralized transcoding is simpler to manage and can use specialized hardware (GPU clusters), but it requires moving raw video files (which are large) to the transcoding cluster. Distributed transcoding reduces data movement but increases operational complexity. The choice depends on the geographic distribution of uploaders and the network topology. YouTube processes uploads in the Google data center closest to the uploader, which effectively distributes the transcoding workload.

---

### Section 10 — Interview Questions

**Beginner Tier**

*Question 1: Why do video streaming platforms split videos into small segments rather than serving the entire file?*

Model Answer: Segmentation serves multiple critical purposes. First, it enables adaptive bitrate streaming — the player can switch quality levels at each segment boundary (every 2-6 seconds) in response to changing network conditions, ensuring smooth playback without long buffering pauses. If the video were a single monolithic file, the player would have to commit to one quality level for the entire duration. Second, segmentation enables efficient CDN caching. Small segments (100 KB to 5 MB each) are perfectly sized for cache storage and can be individually cached and evicted based on popularity. A single large file would consume too much cache space and could not be partially cached. Third, segmentation enables seeking — when a viewer jumps to a specific timestamp, the player only needs to download the segment containing that timestamp rather than downloading everything from the beginning. Fourth, segmentation supports parallel downloads — the player can request multiple segments simultaneously to fill its buffer faster, and can request from different CDN edges if needed.

*Question 2: What is the difference between HLS and DASH, and which would you choose?*

Model Answer: HLS (HTTP Live Streaming) was developed by Apple and uses M3U8 playlist files and MPEG-TS or fMP4 segment containers. DASH (Dynamic Adaptive Streaming over HTTP) is an open international standard (ISO/IEC 23009-1) that uses XML-based MPD (Media Presentation Description) manifest files and fMP4 segments. Functionally, they are very similar — both support adaptive bitrate switching, multiple audio tracks, subtitles, and DRM. The key difference is ecosystem support: HLS is required for iOS and Safari, while DASH is natively supported by most other browsers and devices. In practice, most large platforms support both. If forced to choose one, I would choose HLS because iOS represents a significant and high-value segment of users that cannot be ignored, and most non-Apple platforms can play HLS via libraries like hls.js. However, the optimal approach is to generate both manifests from the same underlying segments (both support fMP4), which adds minimal overhead.

*Question 3: Why is video transcoding necessary? Why not just serve the original uploaded file?*

Model Answer: The original uploaded file is unsuitable for streaming for several reasons. First, it is typically in a format optimized for recording, not streaming — common upload formats like MKV or MOV may not be supported by all browsers and devices. Second, it exists at only one resolution and bitrate, so viewers on slow connections would experience constant buffering while viewers on fast connections might receive unnecessarily low quality. Third, the original file is not segmented, so adaptive bitrate switching is impossible. Fourth, the file may be enormous — a raw 4K video can be 10-20 GB per hour, which would require massive bandwidth even for viewers with fast connections. Transcoding solves all of these problems: it converts to universally supported codecs, produces multiple resolution variants, segments the video for ABR streaming, and applies compression to reduce file sizes by 5-10x while maintaining acceptable quality.

**Mid-Level Tier**

*Question 1: How would you design the upload pipeline to handle a creator uploading a 10 GB video on an unreliable mobile connection?*

Model Answer: The upload pipeline must be chunked and resumable. The client splits the 10 GB file into chunks of approximately 5 MB each (2,000 chunks). Before starting, the client sends an initialization request with the file size, content type, and a SHA-256 checksum of the entire file. The server returns an upload session ID. The client then uploads chunks sequentially (or in parallel with a concurrency limit of 3-5), each including the chunk number and byte range in the request headers. The server stores each chunk in temporary storage (a dedicated S3 bucket) and records the received chunks in a Redis hash keyed by the upload session ID. If the connection drops, the client can query the server for the last received byte offset and resume from the next chunk. Once all chunks are received, the server concatenates them and verifies the SHA-256 checksum against the one provided at initialization. If verification passes, the video is enqueued for transcoding. The temporary chunks are deleted. Upload sessions that remain incomplete for 48 hours are cleaned up by a TTL-based lifecycle policy. Each chunk upload is idempotent — re-uploading the same chunk overwrites the previous version without corruption.

*Question 2: How does a CDN decide which content to cache and which to evict?*

Model Answer: CDN caching for video content uses a combination of strategies. The primary eviction policy is typically LRU (Least Recently Used) or its variant LFU (Least Frequently Used), tuned for video access patterns. However, naive LRU is suboptimal for video because a single sequential viewing of a long video touches many segments once in rapid succession, potentially evicting popular content. Video-aware CDN caching often uses a "two-tier" admission policy: a segment is only promoted to the main cache after it has been requested at least twice within a time window (preventing one-hit-wonder pollution). Additionally, the CDN uses popularity prediction signals from the platform — when a new video from a creator with 50 million subscribers is published, the CDN can proactively warm caches in regions where the creator has the most subscribers, anticipating the flood of requests. Edge servers also employ segment-aware prefetching: when a viewer requests segment N of a video, the edge proactively fetches segments N+1 and N+2 from the regional cache, assuming the viewer will continue watching. Cache capacity allocation considers both recency and frequency, weighted by content type — manifest files (small but frequently requested) get higher priority than video segments.

*Question 3: How would you handle the "thundering herd" problem when a viral video is first published and millions of users try to watch it simultaneously?*

Model Answer: The thundering herd problem occurs when a newly published video receives massive concurrent demand before CDN caches have warmed up. Without mitigation, millions of simultaneous cache misses would hit origin, potentially overwhelming it. Several strategies address this. First, origin shield — a caching layer between regional CDN nodes and origin. When multiple regional nodes simultaneously miss on the same segment, origin shield collapses (deduplicates) these requests into a single fetch from origin, caches the result, and fans it out to all requesting regional nodes. This is called request coalescing or request collapsing. Second, proactive cache warming — when a video from a high-subscriber-count channel is published, the system immediately pushes the first several segments to all major CDN PoPs before any viewer requests them. Third, staggered publishing — instead of making a video available globally at the same instant, the system can roll it out region by region over a few minutes, spreading the cache-warming load. Fourth, rate limiting at origin — if origin is overwhelmed despite these measures, it can queue requests and serve them at a sustainable rate, with CDN nodes retrying with exponential backoff. The combination of origin shield and proactive warming handles the vast majority of thundering herd scenarios.

**Senior Tier**

*Question 1: Netflix claims that over 95% of its traffic is served from within the ISP's own network via Open Connect. How would you architect a similar ISP-embedded CDN, and what are the operational challenges?*

Model Answer: An ISP-embedded CDN requires designing custom hardware appliances, building a deployment and management platform, and establishing business relationships with thousands of ISPs globally. Each appliance needs 100+ TB of storage (using high-capacity HDDs with SSD caching for hot content), 100+ Gbps of network interfaces, and robust remote management capabilities. The content filling strategy is critical: during off-peak hours (typically 2-8 AM local time), the system pushes content predicted to be popular in that region the next day. This prediction uses a combination of catalog freshness (new releases are always pushed), regional popularity (trending content in that country), and personalized demand modeling (aggregated viewing patterns of subscribers served by that ISP).

Operational challenges are enormous. First, hardware lifecycle management — you have thousands of appliances deployed in facilities you do not control, requiring remote provisioning, monitoring, firmware updates, and failure detection with minimal or no physical access. Second, ISP relationships — each ISP has different rack specifications, power budgets, and network configurations, requiring custom integration work. Third, capacity planning — you must predict which content will be needed where, days in advance. Misprediction means cache misses that fall back to the public internet, degrading user experience. Fourth, security — these appliances sit inside third-party facilities, so they must be hardened against physical and network attacks, with encrypted storage and secure boot. Fifth, content rights — some content may have geographic licensing restrictions, requiring careful management of what is pushed to which regions. Despite these challenges, the benefits are substantial: Netflix has reported serving content at better quality and lower cost than any third-party CDN could achieve, because eliminating internet transit is the single most impactful optimization for streaming quality.

*Question 2: How would you design the recommendation system to balance exploitation (recommending content you know the user likes) vs exploration (introducing new or diverse content)?*

Model Answer: The exploration-exploitation trade-off is fundamental to recommendation systems. Pure exploitation — always recommending the most predicted content — leads to filter bubbles and stagnation, where users are never exposed to new genres or creators. Pure exploration — random or deliberately diverse recommendations — degrades short-term engagement because many suggestions will be irrelevant. The solution is a principled balance using techniques from multi-armed bandit literature.

One approach is epsilon-greedy: with probability (1-epsilon), show the highest-ranked recommendation (exploit); with probability epsilon (say 5-10%), show a randomly selected candidate from the lower-ranked pool (explore). A more sophisticated approach is Thompson Sampling: maintain a probability distribution over the expected reward (watch time) for each candidate, and sample from these distributions rather than always picking the maximum expected value. This naturally explores uncertain candidates (new videos with wide confidence intervals) while exploiting well-understood ones.

At the system level, I would reserve dedicated slots in the UI for exploration. For example, on a homepage with 40 recommended videos, 30 might come from the primary ranking model (exploitation), 5 from a "trending in your region" pipeline (mild exploration), 3 from a "because you watched X" pipeline targeting new genres adjacent to the user's history (structured exploration), and 2 from a "new creator spotlight" pipeline that deliberately promotes content from creators the user has never seen (strong exploration). Each slot type is independently A/B tested. The exploration candidates are selected with diversity constraints — ensuring variety in genre, creator, video length, and content age. Over time, the system learns from the user's response to exploration candidates and updates their preference model, gradually expanding the recommendation space without jarring the user.

*Question 3: At YouTube's scale (500 hours of video uploaded per minute), how would you architect the transcoding pipeline to be both cost-efficient and fast?*

Model Answer: The transcoding pipeline at this scale processes approximately 30,000 hours of video per hour, and each hour of video requires roughly 5-15 hours of transcoding compute (depending on codec and resolution), totaling 150,000-450,000 compute-hours per hour. This requires a massive, elastic, cost-optimized compute fleet.

The architecture uses a priority-tiered queue system. Tier 1 (highest priority) handles videos from creators with large subscriber bases (whose audience is waiting), re-encoding of content flagged for urgent re-processing, and live-to-VOD conversions. Tier 2 handles standard uploads. Tier 3 (lowest priority) handles speculative encoding — producing additional resolutions or codecs for content that has crossed popularity thresholds.

The compute fleet is a hybrid of reserved instances (for baseline load), on-demand instances (for predictable peaks), and spot/preemptible instances (for the majority of work). Since transcoding jobs are inherently resumable — if a spot instance is terminated, the partially completed job can be restarted from the last completed segment — spot instances are ideal for this workload. The system achieves 60-70% of its compute from spot instances at 60-80% cost savings.

Each video is split into independent segments for parallel transcoding — a technique called split-and-stitch. A 10-minute video can be split into 150 segments of 4 seconds each, and all 150 can be transcoded in parallel across 150 workers, reducing wall-clock time from minutes to seconds. The stitch phase concatenates the transcoded segments. This parallelization is possible because video segments at keyframe boundaries are independently decodable.

The pipeline also implements intelligent encoding decisions. Not every video needs every resolution: a 360p webcam recording is not upscaled to 4K. The system analyzes the source resolution and quality, and only generates outputs at or below the source quality. Similarly, the codec strategy is popularity-gated: all videos get H.264, but VP9 and AV1 variants are only generated if the video exceeds a view-count threshold (say 1,000 views), at which point the bandwidth savings justify the encoding cost. This reduces total transcoding compute by an estimated 40-60% compared to a blanket all-resolutions-all-codecs approach.

---

### Section 11 — Complete Code Example

Below is a comprehensive implementation covering the core components of a video streaming platform: chunked upload handling, transcoding job management, ABR manifest generation, and a streaming endpoint. We present each component first as language-agnostic pseudocode, then as a working Node.js implementation with detailed explanations.

**Pseudocode: Video Upload Service**

```
FUNCTION initializeUpload(userId, fileName, fileSize, contentType, checksum):
    uploadId = generateUUID()
    totalChunks = CEIL(fileSize / CHUNK_SIZE)

    STORE in Redis:
        key: "upload:{uploadId}"
        value: {
            userId, fileName, fileSize, contentType, checksum,
            totalChunks, receivedChunks: 0, status: "in_progress",
            chunks: empty_bitfield(totalChunks)
        }
        expiry: 48 hours

    RETURN { uploadId, chunkSize: CHUNK_SIZE, totalChunks }

FUNCTION uploadChunk(uploadId, chunkIndex, chunkData):
    session = GET from Redis "upload:{uploadId}"
    IF session is NULL:
        THROW "Upload session expired or not found"

    IF session.chunks[chunkIndex] is already received:
        RETURN { status: "duplicate", nextChunk: findNextMissing(session) }

    STORE chunkData to objectStorage:
        bucket: "temp-uploads"
        key: "{uploadId}/chunk_{chunkIndex}"

    UPDATE Redis session:
        SET chunks[chunkIndex] = 1
        INCREMENT receivedChunks

    IF receivedChunks == totalChunks:
        ENQUEUE assembleAndProcess(uploadId)
        RETURN { status: "complete" }
    ELSE:
        RETURN { status: "ok", nextChunk: findNextMissing(session) }

FUNCTION assembleAndProcess(uploadId):
    session = GET from Redis "upload:{uploadId}"

    // Concatenate all chunks in order
    outputStream = createWriteStream("raw-videos/{uploadId}/{fileName}")
    FOR i FROM 0 TO totalChunks - 1:
        chunkData = READ from objectStorage "temp-uploads/{uploadId}/chunk_{i}"
        WRITE chunkData to outputStream
        DELETE "temp-uploads/{uploadId}/chunk_{i}"
    CLOSE outputStream

    // Verify checksum
    actualChecksum = computeSHA256("raw-videos/{uploadId}/{fileName}")
    IF actualChecksum != session.checksum:
        MARK upload as FAILED
        DELETE assembled file
        RETURN

    // Create video record in database
    videoId = INSERT INTO videos (channel_id, title, raw_file_url, upload_status)
        VALUES (session.channelId, session.fileName, rawUrl, 'processing')

    // Enqueue transcoding
    PUBLISH to "transcode-jobs" queue:
        { videoId, rawFileUrl, sourceResolution, sourceDuration }

    DELETE Redis session
```

**Pseudocode: Transcoding Pipeline**

```
FUNCTION processTranscodeJob(job):
    { videoId, rawFileUrl, sourceResolution } = job

    // Determine which resolutions to generate
    targetResolutions = filterResolutions(AVAILABLE_RESOLUTIONS, sourceResolution)
    // e.g., if source is 720p, only generate 720p, 480p, 360p, 240p

    codecs = ["h264"]  // Always generate H.264
    // VP9 and AV1 added later based on popularity

    FOR EACH resolution IN targetResolutions:
        FOR EACH codec IN codecs:
            segments = splitAtKeyframes(rawFileUrl, SEGMENT_DURATION)

            FOR EACH segment IN segments (IN PARALLEL):
                transcodedSegment = transcode(segment, resolution, codec)
                STORE transcodedSegment to:
                    "segments/{videoId}/{codec}/{resolution}/seg_{index}.ts"

            // Generate resolution-specific playlist
            generatePlaylist(videoId, codec, resolution, segmentCount)

    // Generate master manifest
    generateMasterManifest(videoId, targetResolutions, codecs)

    // Generate thumbnails
    generateThumbnails(rawFileUrl, videoId)

    // Update video status
    UPDATE videos SET upload_status = 'ready',
        manifest_url = "manifests/{videoId}/master.m3u8"
        WHERE video_id = videoId

    // Trigger downstream: search indexing, notification to subscribers
    PUBLISH event: { type: "video_ready", videoId }

FUNCTION generateMasterManifest(videoId, resolutions, codecs):
    manifest = "#EXTM3U\n"
    FOR EACH codec IN codecs:
        FOR EACH res IN resolutions:
            bandwidth = getBitrate(res, codec)
            manifest += "#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},"
            manifest += "RESOLUTION={res.width}x{res.height},"
            manifest += "CODECS=\"{codec.codecString}\"\n"
            manifest += "{codec}/{res}/playlist.m3u8\n"

    STORE manifest to "manifests/{videoId}/master.m3u8"
```

**Node.js Implementation: Video Upload Service**

```javascript
// video-upload-service.js
// Complete implementation of chunked upload handling with resumption support

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { Kafka } = require('kafkajs');

// --- Configuration ---
// CHUNK_SIZE defines how large each upload chunk is. 5 MB is a good balance
// between minimizing HTTP overhead (too-small chunks) and limiting wasted
// bandwidth on failed chunk uploads (too-large chunks).
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk

// UPLOAD_EXPIRY_SECONDS controls how long an incomplete upload session
// remains valid. 48 hours gives users ample time to resume interrupted uploads.
const UPLOAD_EXPIRY_SECONDS = 48 * 60 * 60; // 48 hours

// --- Service Initialization ---
// Redis stores upload session metadata: which chunks have been received,
// total expected chunks, and the file checksum for verification.
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: 6379,
    maxRetriesPerRequest: 3
});

// S3 client for storing both temporary chunks and final assembled videos.
// Temporary chunks go to a bucket with lifecycle policies for cleanup.
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Kafka producer for publishing transcoding jobs. Kafka provides the
// durability and ordering guarantees needed for the job queue.
const kafka = new Kafka({
    clientId: 'upload-service',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
});
const producer = kafka.producer();

const app = express();
app.use(express.json());

// --- Initialize Upload ---
// POST /api/uploads/init
// This endpoint is called once at the start of an upload. It creates a
// session that tracks the upload's progress, enabling resumption if the
// client disconnects and reconnects later.
app.post('/api/uploads/init', async (req, res) => {
    try {
        const { fileName, fileSize, contentType, checksum, channelId } = req.body;

        // Validate required fields. The checksum is critical — it lets us
        // verify the assembled file matches what the client intended to send,
        // catching any corruption during transfer.
        if (!fileName || !fileSize || !checksum) {
            return res.status(400).json({
                error: 'fileName, fileSize, and checksum are required'
            });
        }

        // Calculate how many chunks this file will be split into.
        // Math.ceil ensures the last partial chunk is counted.
        const uploadId = uuidv4();
        const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

        // Store session metadata in Redis with a TTL. The 'receivedChunks'
        // field is a bitfield — each bit represents one chunk, allowing
        // O(1) lookup for whether a specific chunk has been received.
        const session = {
            uploadId,
            fileName,
            fileSize,
            contentType: contentType || 'video/mp4',
            checksum,
            channelId,
            totalChunks,
            receivedCount: 0,
            status: 'in_progress',
            createdAt: Date.now()
        };

        // SETEX stores the session with automatic expiry after 48 hours.
        // This ensures orphaned upload sessions are cleaned up automatically.
        await redis.setex(
            `upload:${uploadId}`,
            UPLOAD_EXPIRY_SECONDS,
            JSON.stringify(session)
        );

        // Initialize a Redis bitfield to track which chunks have been received.
        // Each chunk index maps to a single bit. This is space-efficient:
        // a 10 GB file with 2,000 chunks needs only 250 bytes of tracking data.
        // We do not need to explicitly initialize — Redis GETBIT returns 0
        // for unset bits by default.

        console.log(`Upload initialized: ${uploadId}, ${totalChunks} chunks expected`);

        return res.status(201).json({
            uploadId,
            chunkSize: CHUNK_SIZE,
            totalChunks,
            resumeUrl: `/api/uploads/${uploadId}/status`
        });
    } catch (error) {
        console.error('Failed to initialize upload:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Upload a Single Chunk ---
// PUT /api/uploads/:uploadId/chunks/:chunkIndex
// This endpoint receives one chunk of the file. It is idempotent — uploading
// the same chunk twice is safe and has no side effects beyond a minor
// performance cost.
app.put('/api/uploads/:uploadId/chunks/:chunkIndex', express.raw({
    type: '*/*',
    limit: '6mb'   // Slightly larger than CHUNK_SIZE to account for HTTP overhead
}), async (req, res) => {
    try {
        const { uploadId, chunkIndex } = req.params;
        const chunkIdx = parseInt(chunkIndex, 10);
        const chunkData = req.body; // Raw binary data of this chunk

        // Retrieve the session. If it does not exist, the upload has either
        // expired or was never initialized.
        const sessionData = await redis.get(`upload:${uploadId}`);
        if (!sessionData) {
            return res.status(404).json({
                error: 'Upload session not found or expired'
            });
        }

        const session = JSON.parse(sessionData);

        // Validate chunk index is within the expected range.
        if (chunkIdx < 0 || chunkIdx >= session.totalChunks) {
            return res.status(400).json({
                error: `Invalid chunk index. Expected 0-${session.totalChunks - 1}`
            });
        }

        // Check if this chunk was already received using the Redis bitfield.
        // GETBIT returns 0 if unset, 1 if set.
        const alreadyReceived = await redis.getbit(
            `upload:${uploadId}:chunks`,
            chunkIdx
        );

        if (alreadyReceived) {
            // Chunk already received — this is a duplicate. Return success
            // without re-uploading to S3. This makes the endpoint idempotent.
            return res.status(200).json({
                status: 'duplicate',
                receivedCount: session.receivedCount,
                totalChunks: session.totalChunks
            });
        }

        // Store the chunk in S3 temporary storage. The key follows a
        // deterministic pattern so chunks can be reassembled in order.
        await s3.send(new PutObjectCommand({
            Bucket: process.env.TEMP_BUCKET || 'temp-uploads',
            Key: `${uploadId}/chunk_${String(chunkIdx).padStart(6, '0')}`,
            Body: chunkData,
            ContentType: 'application/octet-stream'
        }));

        // Mark this chunk as received in the bitfield and increment the count.
        // We use a Redis pipeline (MULTI) to execute both operations atomically.
        const pipeline = redis.pipeline();
        pipeline.setbit(`upload:${uploadId}:chunks`, chunkIdx, 1);
        session.receivedCount += 1;
        pipeline.setex(
            `upload:${uploadId}`,
            UPLOAD_EXPIRY_SECONDS,
            JSON.stringify(session)
        );
        await pipeline.exec();

        // Check if all chunks have been received.
        if (session.receivedCount >= session.totalChunks) {
            // All chunks received — trigger assembly and processing.
            // We publish to Kafka rather than processing inline because
            // assembly can take minutes for large files and we do not want
            // to block the HTTP response.
            await producer.send({
                topic: 'upload-assembly-jobs',
                messages: [{
                    key: uploadId,
                    value: JSON.stringify({
                        uploadId,
                        fileName: session.fileName,
                        totalChunks: session.totalChunks,
                        checksum: session.checksum,
                        channelId: session.channelId
                    })
                }]
            });

            // Update session status to 'assembling'
            session.status = 'assembling';
            await redis.setex(
                `upload:${uploadId}`,
                UPLOAD_EXPIRY_SECONDS,
                JSON.stringify(session)
            );

            return res.status(200).json({
                status: 'complete',
                message: 'All chunks received. Processing will begin shortly.'
            });
        }

        return res.status(200).json({
            status: 'ok',
            receivedCount: session.receivedCount,
            totalChunks: session.totalChunks,
            percentComplete: Math.round(
                (session.receivedCount / session.totalChunks) * 100
            )
        });
    } catch (error) {
        console.error('Failed to upload chunk:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Check Upload Status (for resumption) ---
// GET /api/uploads/:uploadId/status
// When a client reconnects after a disconnection, it calls this endpoint
// to learn which chunks were successfully received, so it can resume
// uploading from where it left off.
app.get('/api/uploads/:uploadId/status', async (req, res) => {
    try {
        const { uploadId } = req.params;
        const sessionData = await redis.get(`upload:${uploadId}`);

        if (!sessionData) {
            return res.status(404).json({
                error: 'Upload session not found or expired'
            });
        }

        const session = JSON.parse(sessionData);

        // Read the entire bitfield to determine which chunks are missing.
        // We iterate through each chunk index and check its bit.
        const missingChunks = [];
        for (let i = 0; i < session.totalChunks; i++) {
            const received = await redis.getbit(
                `upload:${uploadId}:chunks`,
                i
            );
            if (!received) {
                missingChunks.push(i);
            }
        }

        return res.status(200).json({
            uploadId,
            status: session.status,
            totalChunks: session.totalChunks,
            receivedCount: session.receivedCount,
            missingChunks,
            percentComplete: Math.round(
                (session.receivedCount / session.totalChunks) * 100
            )
        });
    } catch (error) {
        console.error('Failed to get upload status:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Start server ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
    await producer.connect();
    console.log(`Upload service listening on port ${PORT}`);
});

module.exports = app;
```

**Node.js Implementation: Transcoding Job Queue and Worker**

```javascript
// transcode-worker.js
// Consumes transcoding jobs from Kafka and orchestrates FFmpeg-based encoding

const { Kafka } = require('kafkajs');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');

const execAsync = promisify(exec);

// --- Configuration ---
// RESOLUTIONS defines all possible output resolutions with their target
// bitrates. These bitrates are industry-standard recommendations from
// YouTube and Apple's HLS authoring specification.
const RESOLUTIONS = [
    { name: '2160p', width: 3840, height: 2160, bitrate: '14000k' },
    { name: '1080p', width: 1920, height: 1080, bitrate: '5000k'  },
    { name: '720p',  width: 1280, height: 720,  bitrate: '2800k'  },
    { name: '480p',  width: 854,  height: 480,  bitrate: '1400k'  },
    { name: '360p',  width: 640,  height: 360,  bitrate: '800k'   },
    { name: '240p',  width: 426,  height: 240,  bitrate: '400k'   }
];

// SEGMENT_DURATION controls the length of each HLS segment in seconds.
// 4 seconds balances between quick ABR adaptation (shorter segments) and
// encoding efficiency / reduced manifest size (longer segments).
const SEGMENT_DURATION = 4;

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// PostgreSQL connection pool for updating video metadata after transcoding.
const db = new Pool({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'videodb',
    user: process.env.DB_USER || 'video_service',
    password: process.env.DB_PASSWORD,
    max: 5
});

// --- Probe Source Video ---
// Before transcoding, we analyze the source video to determine its
// resolution, duration, and codec. This information determines which
// output resolutions are appropriate (no upscaling).
async function probeVideo(inputPath) {
    // ffprobe extracts metadata from the video file without processing it.
    // The -v quiet flag suppresses non-essential output.
    // The -print_format json flag produces machine-parseable output.
    // The -show_streams flag includes stream-level details (resolution, codec).
    const { stdout } = await execAsync(
        `ffprobe -v quiet -print_format json -show_format -show_streams "${inputPath}"`
    );

    const probe = JSON.parse(stdout);
    const videoStream = probe.streams.find(s => s.codec_type === 'video');

    return {
        width: parseInt(videoStream.width),
        height: parseInt(videoStream.height),
        duration: parseFloat(probe.format.duration),
        codec: videoStream.codec_name,
        fps: eval(videoStream.r_frame_rate) // e.g., "30000/1001" -> 29.97
    };
}

// --- Filter Resolutions ---
// Only generate output resolutions at or below the source resolution.
// Upscaling a 480p source to 4K wastes compute and storage while providing
// no quality improvement — it just produces a larger file with the same
// visual information.
function filterResolutions(sourceHeight) {
    return RESOLUTIONS.filter(r => r.height <= sourceHeight);
}

// --- Transcode a Single Resolution ---
// Uses FFmpeg to produce HLS segments at a specific resolution and bitrate.
async function transcodeResolution(inputPath, outputDir, resolution) {
    const { name, width, height, bitrate } = resolution;
    const resolutionDir = path.join(outputDir, name);
    await fs.mkdir(resolutionDir, { recursive: true });

    // FFmpeg command breakdown:
    // -i: input file path
    // -vf scale=W:H: resize the video to the target resolution
    // -c:v libx264: encode using H.264 codec (universal compatibility)
    // -preset medium: balance between encoding speed and compression efficiency
    //   (fast=quick but large files, slow=small files but slow encoding)
    // -b:v: target video bitrate
    // -maxrate / -bufsize: constrain bitrate variation for consistent streaming
    // -c:a aac -b:a 128k: encode audio as AAC at 128 kbps
    // -f hls: output format is HLS (HTTP Live Streaming)
    // -hls_time: target segment duration in seconds
    // -hls_list_size 0: include all segments in the playlist (not just recent)
    // -hls_segment_filename: naming pattern for segment files
    const command = [
        'ffmpeg -y',
        `-i "${inputPath}"`,
        `-vf "scale=${width}:${height}"`,
        '-c:v libx264',
        '-preset medium',
        '-profile:v high',
        `-b:v ${bitrate}`,
        `-maxrate ${bitrate}`,
        `-bufsize ${parseInt(bitrate) * 2}k`,
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        '-f hls',
        `-hls_time ${SEGMENT_DURATION}`,
        '-hls_list_size 0',
        '-hls_playlist_type vod',
        `-hls_segment_filename "${resolutionDir}/segment_%04d.ts"`,
        `"${resolutionDir}/playlist.m3u8"`
    ].join(' ');

    console.log(`Transcoding ${name}: ${command}`);
    await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });

    // Return list of generated files for uploading to S3
    const files = await fs.readdir(resolutionDir);
    return files.map(f => ({
        localPath: path.join(resolutionDir, f),
        s3Key: `segments/${name}/${f}`
    }));
}

// --- Generate Master Manifest ---
// The master manifest lists all available quality levels. The video player
// downloads this first, then selects the appropriate quality based on
// network conditions and device capabilities.
function generateMasterManifest(videoId, resolutions) {
    let manifest = '#EXTM3U\n';
    manifest += '#EXT-X-VERSION:3\n\n';

    for (const res of resolutions) {
        const bandwidth = parseInt(res.bitrate) * 1000; // Convert kbps to bps
        manifest += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},`;
        manifest += `RESOLUTION=${res.width}x${res.height},`;
        manifest += `CODECS="avc1.640028,mp4a.40.2",`;
        manifest += `NAME="${res.name}"\n`;
        // The playlist URL is relative to the manifest's location.
        // CDN will serve these from the same base path.
        manifest += `${res.name}/playlist.m3u8\n\n`;
    }

    return manifest;
}

// --- Generate Thumbnails ---
// Extract frames at regular intervals for preview thumbnails and the
// seek-bar scrubbing feature. We use FFmpeg's thumbnail filter which
// selects the most representative frame from each interval.
async function generateThumbnails(inputPath, outputDir, duration) {
    const thumbnailDir = path.join(outputDir, 'thumbnails');
    await fs.mkdir(thumbnailDir, { recursive: true });

    // Extract one thumbnail every 10 seconds for the seek-bar sprite sheet
    const intervalSeconds = 10;
    const thumbnailCount = Math.ceil(duration / intervalSeconds);

    const command = [
        'ffmpeg -y',
        `-i "${inputPath}"`,
        `-vf "fps=1/${intervalSeconds},scale=320:180"`,
        '-q:v 5',                     // JPEG quality level (lower = better)
        `"${thumbnailDir}/thumb_%04d.jpg"`
    ].join(' ');

    await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });

    // Also extract a single "poster" frame from the 25% mark of the video
    // for use as the video's preview image.
    const posterTime = Math.floor(duration * 0.25);
    const posterCommand = [
        'ffmpeg -y',
        `-i "${inputPath}"`,
        `-ss ${posterTime}`,
        '-frames:v 1',
        '-q:v 2',
        `"${thumbnailDir}/poster.jpg"`
    ].join(' ');

    await execAsync(posterCommand);

    const files = await fs.readdir(thumbnailDir);
    return files.map(f => ({
        localPath: path.join(thumbnailDir, f),
        s3Key: `thumbnails/${f}`
    }));
}

// --- Upload Artifacts to S3 ---
// After transcoding, all generated files (segments, playlists, thumbnails)
// are uploaded to S3 for CDN distribution.
async function uploadToS3(videoId, files) {
    const uploadPromises = files.map(async (file) => {
        const fileContent = await fs.readFile(file.localPath);

        // Determine the correct Content-Type for CDN to set proper headers.
        // Incorrect Content-Type can cause playback failures in some players.
        let contentType = 'application/octet-stream';
        if (file.s3Key.endsWith('.m3u8')) contentType = 'application/vnd.apple.mpegurl';
        else if (file.s3Key.endsWith('.ts')) contentType = 'video/MP2T';
        else if (file.s3Key.endsWith('.jpg')) contentType = 'image/jpeg';

        await s3.send(new PutObjectCommand({
            Bucket: process.env.VIDEO_BUCKET || 'processed-videos',
            Key: `${videoId}/${file.s3Key}`,
            Body: fileContent,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000'  // Cache for 1 year
            // Video segments are immutable — same URL always serves same content.
            // This long cache TTL maximizes CDN efficiency.
        }));
    });

    // Upload in batches of 20 to avoid overwhelming S3 with concurrent requests
    const batchSize = 20;
    for (let i = 0; i < uploadPromises.length; i += batchSize) {
        await Promise.all(uploadPromises.slice(i, i + batchSize));
    }
}

// --- Main Worker Loop ---
// The worker continuously consumes jobs from the Kafka topic, processes
// each one, and commits the offset only after successful completion.
// If processing fails, the message is not committed and will be retried.
async function startWorker() {
    const kafka = new Kafka({
        clientId: 'transcode-worker',
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
    });

    const consumer = kafka.consumer({ groupId: 'transcode-workers' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'transcode-jobs', fromBeginning: false });

    await consumer.run({
        // eachMessage is called for each job. If it throws, Kafka will
        // redeliver the message to another worker in the consumer group.
        eachMessage: async ({ topic, partition, message }) => {
            const job = JSON.parse(message.value.toString());
            const { videoId, rawFileUrl } = job;

            console.log(`Processing transcode job for video: ${videoId}`);

            // Create a temporary working directory for this job
            const workDir = path.join('/tmp', `transcode_${videoId}`);
            await fs.mkdir(workDir, { recursive: true });

            try {
                // Step 1: Download raw video from S3 to local disk for FFmpeg
                const localInput = path.join(workDir, 'input.mp4');
                const rawObject = await s3.send(new GetObjectCommand({
                    Bucket: process.env.RAW_BUCKET || 'raw-videos',
                    Key: rawFileUrl
                }));
                const chunks = [];
                for await (const chunk of rawObject.Body) {
                    chunks.push(chunk);
                }
                await fs.writeFile(localInput, Buffer.concat(chunks));

                // Step 2: Probe the source video to determine its properties
                const sourceInfo = await probeVideo(localInput);
                console.log(`Source: ${sourceInfo.width}x${sourceInfo.height}, ` +
                            `${sourceInfo.duration}s, ${sourceInfo.codec}`);

                // Step 3: Determine output resolutions (no upscaling)
                const targetResolutions = filterResolutions(sourceInfo.height);
                console.log(`Target resolutions: ${targetResolutions.map(r => r.name).join(', ')}`);

                // Step 4: Transcode each resolution
                const allFiles = [];
                for (const resolution of targetResolutions) {
                    const files = await transcodeResolution(
                        localInput, workDir, resolution
                    );
                    allFiles.push(...files);
                }

                // Step 5: Generate master manifest
                const masterManifest = generateMasterManifest(videoId, targetResolutions);
                const manifestPath = path.join(workDir, 'master.m3u8');
                await fs.writeFile(manifestPath, masterManifest);
                allFiles.push({
                    localPath: manifestPath,
                    s3Key: 'master.m3u8'
                });

                // Step 6: Generate thumbnails
                const thumbnailFiles = await generateThumbnails(
                    localInput, workDir, sourceInfo.duration
                );
                allFiles.push(...thumbnailFiles);

                // Step 7: Upload all artifacts to S3
                console.log(`Uploading ${allFiles.length} files to S3...`);
                await uploadToS3(videoId, allFiles);

                // Step 8: Update database — mark video as ready
                const manifestUrl = `https://cdn.example.com/${videoId}/master.m3u8`;
                const thumbnailUrl = `https://cdn.example.com/${videoId}/thumbnails/poster.jpg`;

                await db.query(
                    `UPDATE videos
                     SET upload_status = 'ready',
                         manifest_url = $1,
                         thumbnail_url = $2,
                         duration_sec = $3,
                         published_at = NOW(),
                         updated_at = NOW()
                     WHERE video_id = $4`,
                    [manifestUrl, thumbnailUrl, Math.round(sourceInfo.duration), videoId]
                );

                console.log(`Video ${videoId} transcoding complete. ${allFiles.length} files uploaded.`);
            } catch (error) {
                console.error(`Transcoding failed for video ${videoId}:`, error);

                // Mark video as failed in the database so the creator is notified
                await db.query(
                    `UPDATE videos SET upload_status = 'failed', updated_at = NOW()
                     WHERE video_id = $1`,
                    [videoId]
                );

                throw error; // Re-throw so Kafka does not commit the offset
            } finally {
                // Clean up temporary files regardless of success or failure
                await fs.rm(workDir, { recursive: true, force: true });
            }
        }
    });

    console.log('Transcode worker started, waiting for jobs...');
}

startWorker().catch(console.error);
```

**Node.js Implementation: Streaming Endpoint**

```javascript
// streaming-service.js
// Handles manifest requests and video segment serving with CDN integration

const express = require('express');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const Redis = require('ioredis');
const { Pool } = require('pg');

const app = express();

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const redis = new Redis({ host: process.env.REDIS_HOST || 'localhost' });
const db = new Pool({
    host: process.env.DB_HOST || 'localhost',
    database: 'videodb',
    user: process.env.DB_USER || 'video_service',
    password: process.env.DB_PASSWORD
});

// --- Get Video Info and Manifest URL ---
// GET /api/videos/:videoId
// Returns video metadata and the manifest URL the player needs to start
// streaming. The manifest URL points to the CDN, not directly to S3.
app.get('/api/videos/:videoId', async (req, res) => {
    const { videoId } = req.params;

    // Check Redis cache first. Video metadata is read-heavy and changes
    // infrequently, making it an excellent caching candidate.
    const cached = await redis.get(`video:${videoId}`);
    if (cached) {
        return res.json(JSON.parse(cached));
    }

    // Cache miss — query the database
    const result = await db.query(
        `SELECT v.video_id, v.title, v.description, v.duration_sec,
                v.manifest_url, v.thumbnail_url, v.visibility,
                v.created_at, v.published_at,
                c.channel_name, c.channel_id, c.avatar_url AS channel_avatar
         FROM videos v
         JOIN channels c ON v.channel_id = c.channel_id
         WHERE v.video_id = $1 AND v.upload_status = 'ready'`,
        [videoId]
    );

    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Video not found' });
    }

    const video = result.rows[0];

    // Fetch view count from the counter store (separate from SQL because
    // view counts change too rapidly for relational DB write throughput)
    const viewCount = await redis.get(`views:${videoId}`) || 0;
    video.view_count = parseInt(viewCount);

    // Cache the result for 5 minutes. Short TTL because metadata can
    // change (title edits, new view count milestones), but long enough
    // to absorb repeated requests for popular videos.
    await redis.setex(`video:${videoId}`, 300, JSON.stringify(video));

    return res.json(video);
});

// --- Record View Event ---
// POST /api/videos/:videoId/view
// Called by the player when a viewer starts watching. Implements basic
// deduplication to prevent inflated view counts from refreshes.
app.post('/api/videos/:videoId/view', async (req, res) => {
    const { videoId } = req.params;
    const userId = req.headers['x-user-id'] || req.ip;

    // Deduplication: only count one view per user per video per 30-minute
    // window. The Redis key combines the video ID and user identifier.
    const dedupKey = `viewdedup:${videoId}:${userId}`;
    const alreadyCounted = await redis.get(dedupKey);

    if (!alreadyCounted) {
        // Increment the view counter. INCR is atomic, so concurrent
        // requests do not cause lost updates.
        await redis.incr(`views:${videoId}`);

        // Set the dedup key with a 30-minute expiry. After 30 minutes,
        // the same user watching again will count as a new view.
        await redis.setex(dedupKey, 1800, '1');

        // Publish the view event to Kafka for downstream processing:
        // analytics, watch history, recommendation signals, etc.
        // (Kafka producer initialization omitted for brevity)
    }

    return res.status(204).send();
});

// --- Serve Manifest (for origin / non-CDN scenarios) ---
// GET /api/stream/:videoId/manifest
// In production, this would be served by the CDN. This endpoint acts as
// the origin that the CDN fetches from on a cache miss.
app.get('/api/stream/:videoId/manifest', async (req, res) => {
    const { videoId } = req.params;

    try {
        const command = new GetObjectCommand({
            Bucket: process.env.VIDEO_BUCKET || 'processed-videos',
            Key: `${videoId}/master.m3u8`
        });

        const response = await s3.send(command);
        const body = await streamToString(response.Body);

        // Set appropriate headers for HLS manifest
        res.set({
            'Content-Type': 'application/vnd.apple.mpegurl',
            // Short cache TTL for manifests because they might be updated
            // if new resolutions are added after initial transcoding.
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*'
        });

        return res.send(body);
    } catch (error) {
        console.error(`Failed to serve manifest for ${videoId}:`, error);
        return res.status(404).json({ error: 'Manifest not found' });
    }
});

// --- Serve Video Segment (origin endpoint) ---
// GET /api/stream/:videoId/segments/:resolution/:segmentFile
// Origin endpoint for video segments. CDN edge servers fetch from here
// on cache miss, then cache the segment for subsequent viewers.
app.get('/api/stream/:videoId/segments/:resolution/:segmentFile', async (req, res) => {
    const { videoId, resolution, segmentFile } = req.params;

    try {
        const command = new GetObjectCommand({
            Bucket: process.env.VIDEO_BUCKET || 'processed-videos',
            Key: `${videoId}/segments/${resolution}/${segmentFile}`
        });

        const response = await s3.send(command);

        // Set headers that maximize CDN caching efficiency.
        // Video segments are immutable — the same URL always serves the
        // same content — so we can use very long cache TTLs.
        res.set({
            'Content-Type': segmentFile.endsWith('.ts')
                ? 'video/MP2T'
                : 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*'
        });

        // Pipe the S3 response stream directly to the HTTP response
        // to avoid buffering the entire segment in memory.
        response.Body.pipe(res);
    } catch (error) {
        console.error(`Failed to serve segment: ${error.message}`);
        return res.status(404).json({ error: 'Segment not found' });
    }
});

// --- Helper: Convert stream to string ---
async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

// --- Start server ---
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`Streaming service listening on port ${PORT}`);
});

module.exports = app;
```

**Code Walkthrough Summary**

The implementation above covers three interconnected services. The upload service handles chunked uploads with Redis-backed session tracking, supporting resumption by maintaining a bitfield of received chunks. Each chunk is stored independently in S3, and when all chunks arrive, an assembly job is published to Kafka. The transcode worker consumes these jobs, probes the source video, selectively transcodes into appropriate resolutions (never upscaling), generates HLS manifests and thumbnails, and uploads all artifacts to S3 before updating the database. The streaming service acts as the origin for the CDN, serving manifests and segments with appropriate caching headers, recording view events with deduplication, and caching video metadata in Redis.

Together, these services form the core data path of a video streaming platform: from the moment a creator's file leaves their device to the moment pixels appear on a viewer's screen.

---

### Section 12 — Connection to Next Topic

Having designed a system that stores, processes, and streams massive video files across the globe, we have built deep intuition for handling large binary data at scale — chunked uploads, content-addressed storage, tiered caching, and global distribution. These same patterns generalize far beyond video.

In Topic 51, we tackle the Design of a File Storage and Sync Service — think Dropbox, Google Drive, or OneDrive. While the problem appears different on the surface (syncing arbitrary files across a user's devices rather than streaming media to viewers), the underlying engineering challenges share significant DNA with what we have explored here. Chunked upload with resumption? That is exactly how Dropbox handles large file uploads over unreliable connections. Content-addressed storage with deduplication? Dropbox's block-level deduplication uses the same hash-based approach we discussed for video dedup. Tiered storage with hot and cold data? File sync services must decide which files to keep on local SSD, which to offload to cloud storage, and which to archive. Global distribution? A user's files must be accessible from any device, anywhere, with low latency.

The key difference is the access pattern: video streaming is write-once-read-many (a video is uploaded once and streamed millions of times), while file sync is read-write with conflict resolution (a document may be edited simultaneously on a laptop and a phone, requiring the system to detect and resolve conflicts). This shift from one-directional distribution to bidirectional synchronization introduces fascinating new challenges — operational transformation, vector clocks for conflict detection, differential sync to minimize bandwidth, and client-side caching strategies that keep files available offline.

By carrying forward the lessons from video streaming — how to chunk large data for reliable transfer, how to deduplicate at scale, how to distribute content globally, and how to design tiered storage that balances performance against cost — you will approach the file sync problem with a mature mental model. The transition from "streaming large media to many viewers" to "syncing arbitrary files across a user's devices" is a natural evolution of the same core distributed systems principles.

---

*Next up: Topic 51 — Design a File Storage and Sync Service (Dropbox/Google Drive)*

---

<!--
Topic: 51
Title: Design a File Storage and Sync Service (Dropbox)
Section: 11 — Real-World Designs Part 3
Track: 0-to-100 Deep Mastery
Difficulty: Senior
Interview Weight: High
Prerequisites: Topics 1-3, 6, 9, 12, 25
Next Topic: Topic 52 — Design a Ride-Sharing Service
Estimated Reading Time: 45 minutes
-->

## Topic 51: Design a File Storage and Sync Service (Dropbox)

---

### Section 1 — Why This Design?

In 2007, Drew Houston stood at a bus stop heading from Boston to New York and realized he had forgotten his USB drive at home. That moment of frustration with the state of portable storage led him to start building Dropbox during the bus ride itself. The idea was deceptively simple: a folder on your computer that automatically syncs its contents to every other device you own. Files would "just work" across your laptop, phone, and tablet without you ever thinking about it. What Houston discovered, and what every engineer who tackles this problem discovers, is that the gap between "simple concept" and "reliable implementation" is enormous. Dropbox launched in 2008, and by 2012 it had 100 million users. Today, file sync services including Google Drive, Microsoft OneDrive, Apple iCloud Drive, and Box form a critical layer of computing infrastructure used by billions of people daily.

The reason this problem is so fascinating from a systems design perspective is the sheer number of hard distributed systems challenges hiding behind that simple user experience. When a user edits a file on their laptop and expects to see the change on their phone seconds later, they are implicitly demanding a system that handles concurrent writes, conflict resolution, efficient bandwidth usage, large file transfers, deduplication across petabytes of data, real-time notifications across millions of devices, and fault-tolerant storage that never loses a byte. Each of these is a significant engineering challenge on its own. Combining them into a single coherent system that feels instant and invisible to the user is what makes this design worthy of deep study.

In senior-level system design interviews, the file storage and sync service question is among the most frequently asked and most revealing. It tests your understanding of chunking algorithms, content-addressable storage, sync protocols, conflict resolution strategies, metadata management, and real-time communication — all in one question. Interviewers at companies like Google, Meta, Amazon, and of course Dropbox itself use this question to probe whether a candidate can reason about the full stack from client-side file watchers to distributed block storage. A strong answer demonstrates not just knowledge of individual components but the ability to make principled trade-offs between consistency and availability, bandwidth and latency, simplicity and efficiency. This topic will arm you with everything you need to deliver that answer.

---

### Section 2 — Requirements Gathering

Before drawing a single box on a whiteboard, the first thing a senior engineer does in an interview is clarify requirements. File storage services span a wide range of features, and trying to design everything at once leads to a muddled architecture. Let us start with the functional requirements, then move to non-functional constraints, and finally ground the design with back-of-envelope math.

**Functional Requirements**

The core functional requirements for a Dropbox-like service are as follows. First, users must be able to upload and download files of any type and size, from small text documents to multi-gigabyte video files. Second, files must automatically sync across all of a user's devices — when a file changes on one device, all other devices should reflect that change without manual intervention. Third, the system must support file versioning so users can recover previous versions of a file, protecting against accidental edits or deletions. Fourth, users must be able to share files and folders with other users, with configurable permissions (view-only, edit, comment). Fifth, the system must support offline access — users should be able to view and edit files without an internet connection, with changes syncing automatically when connectivity returns. Sixth, the system should provide a web interface for accessing files from any browser. Additional features like comments, activity feeds, and third-party integrations are important for a production system but are out of scope for this design.

**Non-Functional Requirements**

The non-functional requirements are where the real engineering challenges live. Data durability is paramount — the system must never lose a user's data, targeting at minimum 99.999999999% (eleven nines) durability, matching what services like S3 provide. Consistency is critical — when a user saves a file, they must never see a corrupted or partially-written version on another device. Sync latency should be low, with changes propagating to online devices within a few seconds for small files. The system must handle large files efficiently, supporting uploads up to 50GB without timeouts or memory exhaustion. Bandwidth efficiency is essential — the system should minimize data transfer by only sending the parts of a file that actually changed, not re-uploading the entire file on every edit. The system must scale to hundreds of millions of users with high availability (99.9%+ uptime). Security requires encryption both at rest and in transit, with fine-grained access control.

**Back-of-Envelope Estimation**

Let us ground these requirements in concrete numbers. Assume the service has 500 million registered users with 100 million daily active users (DAU). The average user stores 2GB of data, and the average file size is 500KB. This gives us a total storage requirement of 500M users multiplied by 2GB, which equals 1 exabyte (1,000 petabytes) of logical storage. With replication (typically 3x for durability), the raw storage requirement approaches 3 exabytes.

For daily operations, assume each DAU triggers an average of 5 sync events per day (file creates, edits, deletes). That gives us 100M multiplied by 5, which equals 500 million sync events per day, or roughly 5,800 sync events per second on average. During peak hours (assume 3x average), that rises to about 17,400 sync events per second.

For bandwidth, if the average sync event involves transferring 200KB of data (many syncs involve small deltas rather than full files), the daily transfer volume is 500M events multiplied by 200KB, which equals 100 petabytes per day of total transfer, or about 9.3 terabits per second on average. This is a staggering amount of bandwidth, which is precisely why chunking and deduplication are not just optimizations but survival strategies.

For metadata, each file requires roughly 1KB of metadata (path, permissions, version history references, chunk list). With an average of 4,000 files per user (2GB divided by 500KB), the total metadata is 500M users multiplied by 4,000 files multiplied by 1KB, equaling 2 petabytes of metadata. This metadata must be quickly queryable, making database design a critical concern.

These numbers reveal why every major design decision in a file sync service revolves around minimizing unnecessary data transfer and storage.

---

### Section 3 — High-Level Architecture

The architecture of a file sync service is best understood as a collaboration between a smart client and a scalable backend. The client does far more work than in a typical web application — it monitors the filesystem, chunks files, computes hashes, manages local state, and resolves conflicts. The backend provides durable storage, metadata management, authentication, and change notification. This split is deliberate: pushing intelligence to the client reduces server load and enables offline operation.

The high-level components are as follows. The **client application** runs on the user's device and contains several sub-components: a filesystem watcher that detects local changes, a chunking engine that breaks files into blocks, a local metadata database (typically SQLite) that tracks the state of every file, and a sync engine that orchestrates uploads and downloads. The **API servers** are the gateway to the backend, handling authentication, metadata operations, and coordinating sync workflows. The **metadata database** stores the authoritative state of every file — its path, version, chunk list, permissions, and sharing information. The **block storage** layer (built on top of object storage like S3) stores the actual file content as individual chunks identified by their content hash. The **notification service** pushes change events to connected clients so they know when to pull new data.

Here is the architecture in diagram form:

```
+------------------------------------------------------------------+
|                        CLIENT APPLICATION                         |
|                                                                    |
|  +----------------+  +------------+  +-------------------------+  |
|  | File Watcher   |  |  Chunker   |  |     Local Metadata DB   |  |
|  | (inotify/FSE)  |->| (Rolling   |  |      (SQLite)           |  |
|  |                |  |  Hash)     |  |                         |  |
|  +-------+--------+  +-----+------+  +------------+------------+  |
|          |                  |                      |               |
|          +------------------+----------------------+               |
|                             |                                      |
|                      +------+------+                               |
|                      | Sync Engine |                               |
|                      +------+------+                               |
+----------------------------|---------------------------------------+
                             | HTTPS / WebSocket
                             v
+------------------------------------------------------------------+
|                         LOAD BALANCER                              |
+------------------------------------------------------------------+
         |                    |                      |
         v                    v                      v
+----------------+  +------------------+  +---------------------+
|  API Servers   |  | Block Servers    |  | Notification Service|
| (Auth, Meta    |  | (Upload/Download |  | (Long Poll /        |
|  Operations)   |  |  Chunks)         |  |  WebSocket)         |
+-------+--------+  +--------+---------+  +----------+----------+
        |                     |                       |
        v                     v                       v
+----------------+  +------------------+  +---------------------+
| Metadata DB    |  | Block Storage    |  | Message Queue       |
| (MySQL/        |  | (S3 / Blob      |  | (Kafka / Redis      |
|  PostgreSQL     |  |  Storage)        |  |  Pub/Sub)           |
|  + Cache)      |  |                  |  |                     |
+----------------+  +------------------+  +---------------------+
```

The flow for a typical file edit is as follows. The user modifies a file on their laptop. The file watcher detects the change and passes the file to the chunker. The chunker breaks the file into blocks and computes a hash for each block. The sync engine compares the new block list against the previous block list stored in the local metadata database. Only the changed blocks are identified. The sync engine contacts the API server with the new metadata (updated block list, new version number). The API server checks which blocks are already present in block storage (deduplication). The sync engine uploads only the blocks that the server does not already have. The API server updates the metadata database and publishes a change event to the notification service. Other devices belonging to the same user (or users sharing the file) receive the notification, fetch the updated metadata, and download any new blocks they need.

This architecture cleanly separates the data plane (block upload/download) from the control plane (metadata and sync coordination), allowing each to scale independently.

---

### Section 4 — Deep Dive: Chunking and Deduplication

Chunking is the single most important technical decision in a file sync service, and it is the feature that separates a naive file upload system from a production-grade sync engine. Without chunking, editing a single character in a 1GB file would require re-uploading the entire gigabyte. With intelligent chunking, that same edit might require uploading only a 4MB block. The bandwidth savings are not incremental — they are transformative.

**Why Chunking Matters**

There are four compelling reasons to break files into chunks rather than handling them as monolithic blobs. First, bandwidth efficiency: by splitting a file into chunks and tracking which chunks changed, the system only transfers the modified portions. For a 100MB file where only one paragraph changed, this can reduce transfer from 100MB to a few hundred kilobytes. Second, resumable uploads and downloads: if a network connection drops during the transfer of a 10GB file, the system only needs to retry the current chunk rather than starting over. Third, deduplication: many users store identical files (the same PDF attachment, the same software installer), and chunking allows the system to store each unique chunk exactly once, even across different users. Fourth, parallel transfer: multiple chunks can be uploaded or downloaded simultaneously, utilizing the full bandwidth of the connection.

**Fixed-Size vs Content-Defined Chunking**

The simplest approach is fixed-size chunking: divide the file into blocks of a predetermined size, say 4MB. This is easy to implement and works well for appends (adding data to the end of a file). However, it has a critical weakness: if you insert data at the beginning of a file, every single chunk boundary shifts, and the system perceives every chunk as changed, defeating the purpose of delta sync entirely.

Content-defined chunking (CDC) solves this problem elegantly. Instead of cutting at fixed byte positions, CDC uses a rolling hash function (commonly the Rabin fingerprint) to find "natural" chunk boundaries based on the content itself. The algorithm slides a window across the file's bytes, computing a hash at each position. When the hash meets a certain condition (for example, the lowest 13 bits are all zero), that position becomes a chunk boundary. Because the boundary depends on the local content rather than absolute position, inserting data at the beginning of a file only affects the chunks near the insertion point — all subsequent chunks remain identical to their previous versions.

The Rabin fingerprint works as follows. It treats each byte in the sliding window as a coefficient of a polynomial over a finite field (GF(2)). As the window slides one byte forward, the old leading byte is removed and the new trailing byte is added, all in O(1) time. The resulting hash is a pseudo-random function of the window contents. By choosing an appropriate mask (e.g., checking if `hash % 2^13 == 0`), you get an expected chunk size of 8KB (2^13 bytes), though in practice services like Dropbox use larger chunk sizes (4MB) for efficiency. A minimum and maximum chunk size are enforced to prevent pathological cases — a minimum of 2MB prevents tiny chunks from files with unfortunate byte patterns, and a maximum of 8MB prevents enormous chunks that would defeat the purpose of resumable transfers.

**Block-Level Deduplication**

Once files are chunked, each chunk is identified by its cryptographic hash (typically SHA-256). This hash serves as a content-addressable key: if two chunks from different files (or different users) produce the same hash, they are the same data and need only be stored once. This is called block-level deduplication, and it yields enormous storage savings. Studies have shown that in enterprise environments, deduplication ratios of 2:1 to 5:1 are common, meaning a service storing 1 exabyte of logical data might only need 200-500 petabytes of physical storage.

Deduplication can happen on the client side or the server side. In client-side deduplication, the client computes the hash of each chunk before uploading and sends the hash to the server. If the server already has a chunk with that hash, it tells the client to skip the upload. This saves bandwidth but leaks information about what data exists on the server (a privacy concern in some contexts). In server-side deduplication, the client uploads every chunk and the server checks for duplicates after receipt. This uses more bandwidth but is simpler and more secure. Most production systems use a hybrid: client-side dedup for the user's own files (no privacy concern) and server-side for cross-user dedup.

**Delta Sync**

Delta sync takes optimization further by computing the difference between the old version and the new version of a changed chunk and transmitting only the delta. Algorithms like rsync's rolling checksum or xdelta can compute these deltas efficiently. For a 4MB chunk where only 100 bytes changed, the delta might be only a few hundred bytes. Dropbox implemented delta sync in its early years and it dramatically reduced bandwidth consumption. The trade-off is computational cost on both the client and server to compute and apply deltas, which may not be worthwhile for small files or entirely new files.

---

### Section 5 — Sync Engine

The sync engine is the brain of the client application. It is responsible for detecting local changes, communicating with the server, resolving conflicts, and ensuring that the local filesystem converges to the same state as the server's authoritative version. Building a correct sync engine is one of the hardest problems in distributed systems because each client is essentially an independent replica that can diverge from the server at any time (especially during offline operation).

**File Change Detection**

The sync engine must know when a file changes on the local filesystem. There are two primary approaches. The first is filesystem event notifications: operating systems provide APIs that fire events when files are modified — inotify on Linux, FSEvents on macOS, and ReadDirectoryChangesW on Windows. These are efficient because the OS notifies the application of changes rather than requiring the application to poll. However, they have limitations: on Linux, inotify has a configurable limit on the number of watched directories (default 8,192), which can be insufficient for users with deeply nested folder structures. Event notifications can also be unreliable during rapid burst edits or when external processes modify files.

The second approach is periodic polling: the sync engine periodically scans the sync folder, computing checksums of files and comparing them against the last known state. This is reliable but expensive — scanning thousands of files every few seconds consumes CPU and disk I/O. In practice, production sync engines use a hybrid approach: filesystem watchers for real-time detection, supplemented by periodic full scans (every few minutes) to catch any changes that the watcher might have missed.

**Conflict Resolution**

Conflicts arise when two devices edit the same file while both are offline, or when edits happen so close together that the sync engine on one device has not yet received the update from the other. There are several strategies for handling conflicts.

Last-write-wins (LWW) is the simplest approach: the most recent edit (by timestamp) takes precedence, and the older edit is discarded. This is easy to implement but can lead to data loss — a user might spend hours editing a document on their laptop, only to have those changes silently overwritten by a trivial edit made on their phone. For this reason, most file sync services avoid pure LWW for document-level conflicts.

Conflict copies are the approach used by Dropbox and most other sync services. When a conflict is detected, the system keeps both versions: the server version becomes the canonical file, and the conflicting version is saved alongside it with a name like `report (John's conflicting copy 2026-02-25).docx`. This approach never loses data and is transparent to the user, but it requires the user to manually reconcile the two versions. For most file types (Word documents, images, videos), this is the only practical approach because the system cannot understand the file's internal structure well enough to merge changes automatically.

For structured data (like code or plain text), more sophisticated approaches are possible. Operational Transforms (OT), used by Google Docs, transform concurrent operations so they can be applied in any order and still produce the same result. CRDTs (Conflict-free Replicated Data Types) are data structures that are mathematically guaranteed to converge when replicas sync, regardless of the order operations are applied. Both OT and CRDTs are typically used for real-time collaborative editing rather than file sync, but understanding them is important context.

**Sync Protocol**

The sync protocol governs how the client and server communicate to bring a client's state in line with the server. The protocol works as follows. When the sync engine detects a local change, it computes the new chunk list for the changed file. It sends this chunk list along with the file metadata to the API server. The server compares the chunk list against the current server-side version. If the server's version has not changed since the client's last sync (no conflict), the server tells the client which chunks it needs to upload (those not already in block storage). The client uploads the missing chunks to the block servers. The server updates the metadata to reflect the new version.

When the server notifies a client of a remote change, the process reverses. The client fetches the updated metadata, including the new chunk list. It compares the server's chunk list against its local chunk list to determine which chunks it needs to download. It downloads only the missing chunks from the block servers. It reassembles the file from its chunks and writes it to the local filesystem.

A critical detail is version tracking. Each file has a version number (or vector clock) that increments with every change. When a client submits an edit, it includes the version number it based the edit on. If the server's current version is higher, the server knows a conflict has occurred and can trigger the conflict resolution process.

---

### Section 6 — Metadata and Versioning

The metadata layer is the authoritative source of truth for the entire system. While block storage holds the raw bytes, it is the metadata that gives those bytes meaning — associating them with filenames, paths, users, permissions, and version histories. A poorly designed metadata layer will bottleneck the entire system, because every sync operation requires at least one metadata read and often a metadata write.

**Metadata Schema**

The core metadata record for a file might look like this:

```
FileMetadata {
    file_id:        UUID          -- globally unique identifier
    user_id:        UUID          -- owner of the file
    filename:       VARCHAR(255)  -- display name (e.g., "report.docx")
    file_path:      VARCHAR(4096) -- full path (e.g., "/work/reports/report.docx")
    parent_folder:  UUID          -- reference to parent folder's file_id
    is_directory:   BOOLEAN       -- true if this is a folder
    file_size:      BIGINT        -- size in bytes
    checksum:       CHAR(64)      -- SHA-256 hash of the complete file
    chunks:         JSON/ARRAY    -- ordered list of chunk hashes
    version:        BIGINT        -- monotonically increasing version number
    is_deleted:     BOOLEAN       -- soft delete flag (for sync propagation)
    created_at:     TIMESTAMP     -- creation timestamp
    modified_at:    TIMESTAMP     -- last modification timestamp
    modified_by:    UUID          -- device that made the last change
}
```

The `chunks` field deserves special attention. It stores an ordered list of chunk hashes (SHA-256) that, when concatenated, reconstitute the original file. This list is the bridge between the metadata layer and the block storage layer. When a client needs to download a file, it reads the metadata to get the chunk list, then fetches each chunk from block storage by its hash.

For the metadata database, a relational database like MySQL or PostgreSQL is a natural fit because the data is highly structured and many operations require transactional guarantees (for example, creating a shared folder involves atomically creating the folder metadata and the sharing permission records). At Dropbox's scale, the metadata database is sharded by user_id, so all of a user's files reside on the same shard, making most queries local to a single shard. A caching layer (Redis or Memcached) sits in front of the database to absorb read load, especially for frequently accessed metadata like root folder listings.

**File Versioning**

Versioning allows users to recover previous versions of a file. The simplest implementation maintains a separate version history table:

```
FileVersion {
    version_id:     UUID
    file_id:        UUID          -- references FileMetadata
    version_number: BIGINT
    chunks:         JSON/ARRAY    -- chunk list for this version
    file_size:      BIGINT
    modified_at:    TIMESTAMP
    modified_by:    UUID
}
```

Each time a file is modified, a new version record is created with the previous chunk list. Because chunks are stored by content hash and shared via deduplication, storing multiple versions is cheap — only the chunks that actually changed between versions consume additional storage. If version 1 of a file has chunks [A, B, C, D] and version 2 has chunks [A, B, C', D] (only chunk C changed to C'), the system stores only 5 unique chunks total for both versions rather than 8.

Most services retain versions for a fixed period (Dropbox keeps 30 days for free users, 180 days for paid users). A background garbage collection process periodically scans for expired versions and deletes any chunks that are no longer referenced by any current or historical version of any file. This reference counting is critical — a chunk can only be deleted when its reference count drops to zero across all files and all versions for all users.

**Namespace Management and Sharing**

The folder hierarchy is modeled as a tree where each node (file or folder) references its parent via the `parent_folder` field. This makes operations like "list contents of a folder" efficient (query all records with a given parent_folder), but operations like "move a folder" require updating the parent_folder of only the moved folder (not its entire subtree, since they still reference the moved folder as their parent).

Sharing introduces a significant complexity. When User A shares a folder with User B, both users see the folder in their namespace, but the underlying files and chunks exist only once in storage. The sharing model requires a permissions table:

```
SharePermission {
    share_id:       UUID
    file_id:        UUID          -- the shared file or folder
    owner_id:       UUID          -- the user who shared it
    shared_with:    UUID          -- the user it was shared with
    permission:     ENUM          -- 'viewer', 'editor', 'owner'
    created_at:     TIMESTAMP
}
```

When User B accesses a shared folder, the system checks both the ownership and the sharing permissions to determine access rights. Shared folders also add complexity to sync: changes made by any user with edit permission must propagate to all other users who have access to that folder.

---

### Section 7 — Storage Architecture

The storage layer must reliably hold exabytes of data, serve reads at low latency, and do so cost-effectively. This is where the design leverages cloud object storage as a foundation and builds content-addressable storage semantics on top.

**Content-Addressable Block Storage**

Every chunk stored in the system is keyed by its SHA-256 hash. This means the storage key is derived from the content itself — hence "content-addressable." If you store a chunk with hash `a1b2c3...`, you can retrieve it by asking for the object at key `a1b2c3...`. This has profound implications for the system design.

First, deduplication is automatic: if two users upload the same chunk, the second upload either overwrites the first with identical data (a no-op) or is skipped entirely if the system checks for existence first. Second, data integrity is verifiable: after downloading a chunk, the client can compute its SHA-256 hash and compare it against the expected hash, detecting any corruption during transfer or storage. Third, caching is trivially correct: because a given hash always maps to the same content, cached chunks never become stale.

In practice, block storage is implemented on top of Amazon S3, Azure Blob Storage, or Google Cloud Storage. These services provide eleven nines of durability by replicating data across multiple availability zones. The chunk hashes are used as S3 object keys, potentially with a prefix derived from the first few characters of the hash for even distribution across storage partitions (e.g., `a1/b2/a1b2c3d4e5f6...`).

**Reference Counting**

Because chunks are shared across files, versions, and users, the system cannot simply delete a chunk when a single file is deleted. Instead, each chunk maintains a reference count — the number of file-version records that include it in their chunk list. When a file is deleted or a version expires, the reference counts of its chunks are decremented. When a chunk's reference count reaches zero, it is eligible for garbage collection. This is analogous to reference counting in memory management and carries similar challenges: the system must ensure that reference count updates are atomic and that no race conditions can cause a chunk to be prematurely deleted while it is still being referenced.

A practical implementation uses a background garbage collector that runs periodically. Rather than decrementing reference counts in real-time (which creates hot spots on frequently-shared chunks), the system can use a mark-and-sweep approach: scan all active file-version records to build a set of live chunk hashes, then delete any chunk not in that set. This is more expensive but safer and simpler.

**Compression and Encryption**

Before storing a chunk, the system can compress it to save storage space. Compression ratios vary wildly by file type — text files might compress 5:1, while JPEG images or already-compressed archives gain almost nothing. For this reason, the system typically attempts compression and only stores the compressed version if it is actually smaller than the original. LZ4 is a popular choice for its speed, while zstd offers better ratios at moderate CPU cost.

Encryption is non-negotiable. All data is encrypted in transit using TLS. For encryption at rest, each chunk is encrypted with AES-256 before being stored in block storage. The encryption key management can follow different models: in the simplest case, the service manages keys (server-side encryption). For higher security, the system can support client-side encryption where the client encrypts chunks before uploading them, and the server never sees plaintext data. Dropbox uses server-side encryption with keys managed in a separate, highly secured key management service.

**Storage Tiering**

Not all data is accessed equally. A file edited yesterday is far more likely to be accessed than a file untouched for two years. Storage tiering exploits this by moving infrequently accessed data to cheaper storage classes. For example, S3 offers Standard (hot), Infrequent Access (warm), and Glacier (cold) tiers with decreasing cost but increasing retrieval latency. A background process monitors chunk access patterns and migrates chunks between tiers accordingly. The metadata records the current storage tier for each chunk so the system can warn users of retrieval delays for cold data.

---

### Section 8 — Notification and Real-Time Sync

A sync service that requires users to manually click "sync" is not a sync service — it is a file upload tool. Real-time sync demands that when a file changes on one device, all other interested devices learn about it within seconds. The notification system makes this possible.

**Notification Strategies**

There are three primary approaches to notifying clients of server-side changes. Long polling is the simplest: the client makes an HTTP request to the server asking "do you have any changes for me?" If the server has changes, it responds immediately. If not, it holds the connection open (for up to 30-60 seconds) until changes arrive or the timeout expires. The client then immediately issues a new long poll request. Long polling works through all firewalls and proxies, making it the most compatible option. Dropbox originally used long polling for its notification service.

WebSocket connections provide true bidirectional communication over a single persistent TCP connection. Once established, the server can push notifications to the client instantly without the client needing to re-issue requests. WebSockets are more efficient than long polling (no repeated HTTP headers, lower latency), but they can be problematic behind certain corporate proxies and firewalls. Modern sync services typically prefer WebSockets with a long polling fallback.

Push notifications (APNs for iOS, FCM for Android) are used for mobile devices that may not maintain persistent connections. When a file changes, the server sends a push notification that wakes the mobile app, which then connects to the server to pull the changes. Push notifications have higher latency and are less reliable than direct connections, but they are essential for mobile battery efficiency.

**Sync Protocol in Detail**

The end-to-end sync flow when a remote change occurs works as follows. The notification service sends a lightweight signal to the client — it does not include the full change details, just a signal that something has changed (and possibly which namespace or folder was affected). The client, upon receiving this signal, contacts the API server to fetch the metadata diff since its last sync point. The server returns a list of changed file metadata records, each with its new chunk list. The client compares each remote chunk list against its local state to determine which chunks it needs to download. The client downloads the missing chunks from the block servers, potentially in parallel. The client reassembles each changed file from its chunks, writes it to the local filesystem, and updates its local metadata database to reflect the new state.

This pull-based approach (notify, then pull) is superior to a push-based approach (pushing full file data through the notification channel) for several reasons. Notification channels should be lightweight and fast — they should not be burdened with large data payloads. The client may not need all changes immediately (it might be on a metered connection and want to defer large downloads). And separating the notification channel from the data channel allows each to scale independently.

**Batching and Throttling**

Rapid file changes (for example, a build process generating hundreds of files in seconds) can overwhelm the sync system if each change triggers an immediate sync. The sync engine employs several strategies to handle this. Change coalescing waits a short period (500ms to 2 seconds) after detecting a change before initiating sync, allowing multiple rapid changes to be batched into a single sync operation. Rate limiting caps the number of concurrent uploads and downloads to prevent the sync engine from saturating the network connection and interfering with the user's other activities. Priority queuing ensures that user-initiated actions (opening a file from another device) take precedence over background sync operations. Bandwidth throttling allows users to set limits on how much bandwidth the sync engine can consume, which is especially important on metered connections.

---

### Section 9 — Trade-Offs and Design Decisions

Every design decision in a file sync service involves trade-offs, and articulating these trade-offs clearly is what separates a good interview answer from a great one. Let us examine the most important decisions.

**Fixed-Size vs Content-Defined Chunking**

Fixed-size chunking is simpler to implement, has predictable performance characteristics, and works well for files that are primarily appended to (like log files). Content-defined chunking (CDC) with rolling hashes handles insertions and deletions far better, producing more stable chunk boundaries that maximize deduplication. The trade-off is implementation complexity and a small CPU overhead for the rolling hash computation. For a general-purpose file sync service, CDC is the clear winner because user files exhibit all types of edit patterns. However, if the service primarily handles append-only files or immutable objects, fixed-size chunking may be sufficient and simpler.

**Sync Frequency vs Bandwidth Consumption**

Syncing more frequently provides a better user experience (changes appear on other devices faster) but consumes more bandwidth and server resources. Syncing less frequently saves resources but creates a worse experience and increases the window for conflicts. The resolution is adaptive sync: sync immediately for small, user-initiated changes, batch large or automated changes, and reduce sync frequency when the user is on a metered or slow connection. The client should also be smart about sync priority — a file the user just opened on another device should sync immediately, while a background backup can wait.

**Eventual vs Strong Consistency**

For file metadata, eventual consistency is generally acceptable with one critical exception: the system must never present a user with a file in an inconsistent state (partially updated metadata, mismatched chunk lists). Within a single user's namespace, metadata operations should be strongly consistent — when the server acknowledges an upload, all subsequent reads must reflect that upload. Across different users sharing a folder, eventual consistency with a propagation delay of a few seconds is acceptable. The metadata database achieves this through leader-follower replication with reads directed to the leader for the owning user's operations and to followers for cross-user access.

**Client-Side vs Server-Side Deduplication**

Client-side deduplication saves bandwidth by not uploading chunks that the server already has. The client computes the chunk hash and asks the server "do you have this?" before uploading. This is efficient but has privacy implications: it reveals that the data exists on the server, which in theory could be exploited (for example, determining whether a specific file has been uploaded by any user). Server-side deduplication uploads all chunks and deduplicates after receipt, using more bandwidth but maintaining privacy. A practical middle ground is to perform client-side deduplication only within a user's own data and across explicitly shared folders, while using server-side deduplication for cross-user savings.

**Flat vs Hierarchical Storage**

In block storage, chunks can be stored in a flat namespace (all chunks in one bucket with their hash as the key) or in a hierarchical structure (organized by user, file, or hash prefix). Flat storage with content-addressable keys maximizes deduplication because identical chunks are automatically consolidated regardless of which user or file they belong to. Hierarchical storage makes it easier to manage per-user quotas and perform per-user operations like account deletion. Most production systems use flat content-addressable storage for chunks (maximizing deduplication) while maintaining the hierarchical namespace in the metadata layer.

---

### Section 10 — Interview Questions

**Beginner Level**

*Question 1: Why do we break files into chunks instead of uploading them as whole files?*

Model Answer: Chunking serves four critical purposes. First, it enables bandwidth-efficient delta sync: when a user edits a small part of a large file, only the chunks that changed need to be re-uploaded, not the entire file. For a 1GB file with a minor edit, this can reduce upload from 1GB to just 4MB (one chunk). Second, it enables resumable transfers: if a network interruption occurs during the upload of a 10GB file, the system only needs to retry the current chunk rather than restarting from scratch. Third, it enables deduplication: identical chunks across different files or users are stored only once, saving massive amounts of storage. In practice, deduplication saves 30-60% of storage across a large user base. Fourth, chunks can be transferred in parallel, utilizing the full available bandwidth. A typical chunk size of 4MB balances these benefits against the overhead of managing many small chunks.

*Question 2: How would you handle the case where two users edit the same shared file at the same time?*

Model Answer: When two users edit the same file concurrently, a conflict occurs. The system detects this during the sync process: when User B tries to submit their edit, the server notices that User B's edit is based on version N of the file, but the server already has version N+1 (submitted by User A). At this point, the system creates a conflict copy — it keeps User A's version as the canonical file and saves User B's version as a separate file with a name like `report (User B's conflicting copy).docx`. Both users are notified of the conflict and can manually reconcile the two versions. This approach is used by Dropbox and most file sync services because it guarantees no data is ever lost. For specialized file types like plain text or code, the system could potentially attempt automatic merging using diff-merge algorithms, but for binary files (images, videos, Office documents), conflict copies are the only safe approach.

*Question 3: Why do we use content hashes (like SHA-256) as storage keys for chunks?*

Model Answer: Using the SHA-256 hash of a chunk's content as its storage key creates a content-addressable storage system with several powerful properties. First, deduplication is inherent: if two chunks have the same content, they produce the same hash and map to the same storage key, so they are automatically stored only once. Second, integrity verification is built-in: after downloading a chunk, the client can recompute its hash and compare it to the expected value, detecting any corruption during transfer or storage. Third, caching is trivially correct: because a given hash always maps to the same immutable content, cached chunks can never become stale, enabling aggressive caching at every layer. Fourth, it simplifies the storage layer: the block store only needs to support simple key-value operations (put and get by hash), with no complex querying required.

**Mid Level**

*Question 1: Explain the difference between fixed-size chunking and content-defined chunking. When would you choose one over the other?*

Model Answer: Fixed-size chunking divides a file into blocks of a predetermined size (e.g., 4MB). It is simple to implement and provides predictable chunk sizes, but it has a fundamental weakness: if data is inserted at the beginning or middle of a file, all subsequent chunk boundaries shift, making every chunk appear "changed" even though most of the content is identical. This defeats delta sync.

Content-defined chunking (CDC) uses a rolling hash function like the Rabin fingerprint to determine chunk boundaries based on the local content. The algorithm slides a window across the file's bytes, and when the hash value meets a specific condition (e.g., lowest 13 bits are zero), it marks a chunk boundary. Because boundaries depend on local content, an insertion shifts only the nearby chunks — all others remain unchanged.

I would choose fixed-size chunking for append-only workloads (log files, database backups) where insertions never occur in the middle, and for systems where implementation simplicity is prioritized. I would choose CDC for a general-purpose file sync service where users edit documents of all types and edit patterns are unpredictable. The CPU overhead of the rolling hash (roughly 200-400 MB/s throughput on modern hardware) is negligible compared to the bandwidth savings.

*Question 2: How would you design the metadata database to handle 500 million users and 2 trillion files?*

Model Answer: At this scale, a single database instance cannot handle the load. The metadata database must be sharded. The natural shard key is user_id because most operations are scoped to a single user (list my files, sync my changes). Sharding by user_id keeps all of a user's files on the same shard, avoiding cross-shard queries for the common case. I would use consistent hashing to map user_ids to shards, allowing the system to add shards as the user base grows without a full re-sharding.

Within each shard, I would use a relational database (MySQL or PostgreSQL) because the data is highly structured, relationships matter (parent-child folder hierarchy, version history), and transactional guarantees are important (creating a shared folder requires atomically creating the folder and setting permissions). A Redis caching layer in front of each shard would absorb read-heavy operations like listing folder contents.

For shared folders, cross-user queries are unavoidable. When User A modifies a file in a folder shared with User B, the system must update the metadata on User A's shard and notify the notification service to alert User B. This is handled asynchronously — the metadata write is committed on User A's shard, a change event is published to a message queue (Kafka), and the notification service delivers the event to User B's connected clients. User B's shard is not directly written to; instead, User B's client fetches the shared folder's metadata from User A's shard (or a read replica) when it processes the notification.

*Question 3: Walk me through the complete lifecycle of uploading a new 100MB file to the sync service.*

Model Answer: The lifecycle begins on the client. The file watcher detects a new file in the sync folder. The chunking engine processes the file using content-defined chunking with a Rabin fingerprint, producing approximately 25 chunks of roughly 4MB each. For each chunk, the engine computes the SHA-256 hash. The sync engine assembles the file metadata: filename, path, size, and the ordered list of 25 chunk hashes.

The client sends the metadata and the list of chunk hashes to the API server. The server checks each hash against block storage to see which chunks already exist (client-side deduplication). Suppose 5 of the 25 chunks already exist from other files. The server responds with a list of the 20 chunks that need to be uploaded.

The client uploads the 20 new chunks to the block servers in parallel, using 4-8 concurrent connections. Each upload is over HTTPS and includes the chunk hash for verification. The block server verifies each received chunk by recomputing its hash, then stores it in S3 with the hash as the key.

Once all chunks are uploaded, the client notifies the API server that the upload is complete. The API server atomically creates the file metadata record in the metadata database, setting the version to 1. The server then publishes a change event to the notification service (via Kafka).

The notification service delivers the event to all other devices belonging to the user that have active connections (via WebSocket or long poll). Each receiving client fetches the new file metadata, sees the list of 25 chunks, checks its local cache for any it already has, and downloads the rest from the block servers. Finally, each client reassembles the file from its chunks and writes it to the local sync folder.

Total time for a 100MB file on a 50 Mbps connection: chunking takes about 0.5 seconds, metadata exchange takes about 0.2 seconds, uploading 20 chunks (80MB) at 50 Mbps takes about 13 seconds, and the server-side processing adds another 0.3 seconds. The receiving client starts downloading almost immediately after the upload completes (the notification arrives within 1 second), so the end-to-end latency from save to availability on another device is roughly 15-20 seconds. For files where most chunks already exist (editing a previously synced file), the upload is dramatically faster.

**Senior Level**

*Question 1: How would you handle a scenario where Dropbox needs to migrate from its own data centers to a cloud provider (or vice versa) without any downtime or data loss?*

Model Answer: This is essentially a live migration of exabytes of data, which is one of the hardest operational challenges in systems engineering. The approach is a dual-write, gradual migration.

Phase 1 (Dual Write): All new chunk uploads are written to both the old storage and the new storage simultaneously. The metadata database is updated to track which storage system each chunk resides in. This ensures no new data is only in the old system.

Phase 2 (Background Migration): A fleet of migration workers copies existing chunks from old storage to new storage. This process runs at a controlled rate to avoid overwhelming either system. Each migrated chunk is verified by comparing hashes after the copy. The migration of exabytes of data will take weeks or months even with massive parallelism.

Phase 3 (Read Cutover): The system is updated to prefer reading from the new storage, falling back to old storage for chunks not yet migrated. This is done gradually, starting with a small percentage of reads and increasing as confidence builds. Client-side hash verification ensures data integrity regardless of which storage backend serves the chunk.

Phase 4 (Write Cutover): Once all chunks are migrated and verified, new writes go only to the new storage. The old storage becomes read-only.

Phase 5 (Cleanup): After a safety period (weeks), the old storage is decommissioned and its data is deleted.

The key insight is that content-addressable storage makes this migration much easier than it would be otherwise. Because chunks are immutable and identified by their content hash, a chunk in the old system and the new system are provably identical if their hashes match. There is no risk of stale data or version conflicts during migration. The dual-write period handles the seam between old and new, and background migration handles the bulk transfer.

*Question 2: How would you design the system to efficiently handle a user who has 10 million small files (1KB each) in their sync folder?*

Model Answer: 10 million small files stress the system differently than large files. The metadata overhead dominates: 10 million files at 1KB of metadata each requires 10GB of metadata for this single user, far more than their 10GB of actual file data. Individual chunk uploads for 1KB files are extremely inefficient due to HTTP overhead, TLS handshake costs, and the overhead of individual S3 PUT operations.

I would address this with several strategies. First, pack small files: rather than storing each 1KB file as an individual chunk in S3, aggregate many small files into a single larger "pack" object (say 64MB). The metadata for each small file records which pack it belongs to and its offset within the pack. This dramatically reduces the number of S3 objects and makes uploads/downloads efficient. Reading a single file requires a range read from the pack.

Second, batch metadata operations: rather than making 10 million individual metadata API calls, the sync protocol should support batch operations — sending metadata for hundreds or thousands of files in a single request. The initial sync of 10 million files should use a streaming protocol that efficiently transfers the complete file tree.

Third, hierarchical sync: rather than tracking every file individually during the notification process, track changes at the folder level. Instead of 10 million file-level notifications, the system can notify that a folder has changed and let the client request the diff.

Fourth, metadata compression: the file listing for this user can be compressed significantly since many files likely share common path prefixes and have similar metadata patterns. The sync protocol should support compressed metadata transfer.

Fifth, client-side database optimization: the local SQLite database must be tuned for 10 million records — proper indexing on file path and parent folder, WAL mode for concurrent reads during sync, and potentially splitting the database across multiple files for parallelism.

*Question 3: How would you implement end-to-end encryption where even the service provider cannot read user files, while still supporting sharing and deduplication?*

Model Answer: End-to-end encryption (E2EE) fundamentally conflicts with server-side deduplication because the server cannot see the content and therefore cannot determine if two chunks are identical. This is one of the most interesting trade-offs in file sync design.

For E2EE, each user generates a keypair. The private key is derived from their password using a key derivation function (e.g., Argon2) and never leaves the client. Files are encrypted on the client before chunking and uploading. However, if we encrypt before chunking, identical files uploaded by different users will produce different ciphertext (because they use different keys), eliminating cross-user deduplication.

A practical approach is convergent encryption: instead of encrypting with the user's key, derive the encryption key from the content itself (e.g., the SHA-256 hash of the plaintext chunk). This means identical plaintext chunks produce identical ciphertext, preserving deduplication. However, convergent encryption is vulnerable to confirmation attacks: an attacker who suspects a user has a specific file can encrypt that file with the same convergent key and check if the resulting ciphertext exists on the server.

For sharing with E2EE, when User A shares a file with User B, User A must encrypt the file's decryption key with User B's public key and store this encrypted key on the server. User B retrieves the encrypted key, decrypts it with their private key, and uses it to decrypt the file. This adds a layer of key management — the metadata now includes an encrypted key for each user who has access.

The most secure approach abandons cross-user deduplication entirely: each user encrypts with their own key, the server stores the ciphertext, and deduplication only works within a single user's data (where the same key is used). This is the approach taken by services like Tresorit and SpiderOak. The storage cost increase (losing cross-user dedup, roughly 30-50% more storage) is the price of true end-to-end encryption. In an interview, acknowledging this trade-off explicitly demonstrates mature architectural thinking.

---

### Section 11 — Complete Code Example

This section provides a comprehensive implementation covering file chunking with a rolling hash, block-level deduplication, a sync engine with conflict detection, and a change notification system. We begin with pseudocode to establish the logic clearly, then provide a full Node.js implementation with line-by-line explanations.

**Pseudocode: Core Sync Engine**

```
ALGORITHM: ContentDefinedChunking(file_data)
    INPUT: file_data - byte array of the file
    OUTPUT: list of chunks, each with content and hash

    chunks = []
    window_size = 48           // bytes in the rolling hash window
    min_chunk = 2 MB
    max_chunk = 8 MB
    mask = 0x0000000000001FFF  // expect boundary every 8KB (2^13)

    hash = 0
    chunk_start = 0
    position = 0

    FOR position FROM 0 TO LENGTH(file_data) - 1:
        // Update rolling hash: add new byte, remove old byte
        hash = ROLLING_HASH_UPDATE(hash, file_data[position],
                  IF position >= window_size THEN file_data[position - window_size] ELSE 0)

        chunk_length = position - chunk_start + 1

        // Check if we should cut a chunk boundary
        IF (chunk_length >= min_chunk AND (hash AND mask) == 0)
           OR chunk_length >= max_chunk:

            chunk_content = file_data[chunk_start .. position]
            chunk_hash = SHA256(chunk_content)
            chunks.APPEND({content: chunk_content, hash: chunk_hash})
            chunk_start = position + 1
            hash = 0

    // Handle remaining bytes as final chunk
    IF chunk_start < LENGTH(file_data):
        chunk_content = file_data[chunk_start .. LENGTH(file_data) - 1]
        chunk_hash = SHA256(chunk_content)
        chunks.APPEND({content: chunk_content, hash: chunk_hash})

    RETURN chunks


ALGORITHM: SyncLocalChange(file_path, sync_engine)
    INPUT: file_path - path to the changed file
    OUTPUT: sync result (success or conflict)

    // Step 1: Read file and chunk it
    file_data = READ_FILE(file_path)
    new_chunks = ContentDefinedChunking(file_data)
    new_chunk_hashes = [chunk.hash FOR chunk IN new_chunks]

    // Step 2: Get previous state from local metadata
    local_meta = sync_engine.local_db.GET(file_path)
    old_chunk_hashes = IF local_meta EXISTS THEN local_meta.chunks ELSE []
    base_version = IF local_meta EXISTS THEN local_meta.version ELSE 0

    // Step 3: Determine which chunks are new
    changed_hashes = new_chunk_hashes - old_chunk_hashes  // set difference

    // Step 4: Ask server which chunks it needs
    server_response = API_SERVER.submit_change(
        file_path, new_chunk_hashes, base_version)

    IF server_response.status == "CONFLICT":
        // Server has a newer version than our base version
        HANDLE_CONFLICT(file_path, server_response.server_version)
        RETURN "conflict"

    // Step 5: Upload only the chunks the server doesn't have
    needed_hashes = server_response.needed_chunks
    FOR hash IN needed_hashes:
        chunk = FIND chunk IN new_chunks WHERE chunk.hash == hash
        BLOCK_SERVER.upload(hash, chunk.content)

    // Step 6: Confirm upload complete
    API_SERVER.confirm_upload(file_path, new_chunk_hashes, base_version + 1)

    // Step 7: Update local metadata
    sync_engine.local_db.PUT(file_path, {
        chunks: new_chunk_hashes,
        version: base_version + 1
    })

    RETURN "success"


ALGORITHM: HandleRemoteChange(notification, sync_engine)
    INPUT: notification - change event from server
    OUTPUT: updated local file

    // Step 1: Fetch updated metadata from server
    remote_meta = API_SERVER.get_metadata(notification.file_path)

    // Step 2: Check for local-remote conflict
    local_meta = sync_engine.local_db.GET(notification.file_path)
    IF local_meta.has_uncommitted_changes:
        CREATE_CONFLICT_COPY(notification.file_path, local_meta)

    // Step 3: Determine which chunks we need to download
    local_chunks = SET(local_meta.chunks)
    remote_chunks = SET(remote_meta.chunks)
    needed_chunks = remote_chunks - local_chunks

    // Step 4: Download missing chunks
    FOR hash IN needed_chunks:
        chunk_data = BLOCK_SERVER.download(hash)
        VERIFY SHA256(chunk_data) == hash
        LOCAL_CACHE.store(hash, chunk_data)

    // Step 5: Reassemble file from chunks in order
    file_data = CONCATENATE(
        [LOCAL_CACHE.get(hash) FOR hash IN remote_meta.chunks])

    // Step 6: Write file and update metadata
    WRITE_FILE(notification.file_path, file_data)
    sync_engine.local_db.PUT(notification.file_path, remote_meta)
```

**Node.js Implementation**

```javascript
// file-sync-engine.js
// A complete implementation of core file sync components:
// - Rolling hash (Rabin fingerprint) based chunking
// - Content-addressable block store with deduplication
// - Sync engine with conflict detection
// - Change notification via WebSocket

const crypto = require('crypto');
const fs = require('fs');
const EventEmitter = require('events');

// ============================================================
// SECTION 1: Rolling Hash for Content-Defined Chunking
// ============================================================

class RollingHash {
  // Implements a polynomial rolling hash (simplified Rabin fingerprint).
  // The hash is computed over a sliding window of bytes, allowing O(1)
  // updates as the window moves forward by one byte.

  constructor(windowSize = 48) {
    this.windowSize = windowSize;       // Number of bytes in the sliding window
    this.hash = 0;                       // Current hash value
    this.window = Buffer.alloc(windowSize); // Circular buffer for window bytes
    this.windowPos = 0;                  // Current position in the circular buffer
    this.BASE = 257;                     // Prime base for polynomial hash
    this.MOD = (1 << 31) - 1;           // Mersenne prime modulus (2^31 - 1)

    // Precompute BASE^windowSize mod MOD.
    // This is used to remove the contribution of the outgoing byte.
    this.basePow = 1;
    for (let i = 0; i < windowSize; i++) {
      this.basePow = (this.basePow * this.BASE) % this.MOD;
    }
  }

  // Update the rolling hash with a new byte.
  // Removes the oldest byte in the window and adds the new one.
  // Returns the updated hash value.
  update(newByte) {
    const oldByte = this.window[this.windowPos];  // Byte leaving the window

    // Store the new byte in the circular buffer
    this.window[this.windowPos] = newByte;
    this.windowPos = (this.windowPos + 1) % this.windowSize;

    // Update hash: remove old byte's contribution, add new byte's
    // hash = (hash * BASE - oldByte * BASE^windowSize + newByte) mod MOD
    this.hash = (
      (this.hash * this.BASE) % this.MOD
      - (oldByte * this.basePow) % this.MOD
      + newByte
      + this.MOD  // Ensure non-negative before final mod
    ) % this.MOD;

    return this.hash;
  }

  // Reset the hash state for processing a new file.
  reset() {
    this.hash = 0;
    this.window.fill(0);
    this.windowPos = 0;
  }
}

// ============================================================
// SECTION 2: Content-Defined Chunking Engine
// ============================================================

class ChunkingEngine {
  // Breaks a file into variable-sized chunks using content-defined
  // boundaries. The rolling hash determines where to cut, producing
  // chunks whose boundaries depend on local content rather than
  // absolute position. This means insertions only affect nearby chunks.

  constructor(options = {}) {
    this.minChunkSize = options.minChunkSize || 256 * 1024;      // 256 KB minimum
    this.maxChunkSize = options.maxChunkSize || 4 * 1024 * 1024; // 4 MB maximum
    this.avgChunkSize = options.avgChunkSize || 1 * 1024 * 1024; // 1 MB target average

    // The mask determines average chunk size.
    // If we check (hash & mask) === 0, the average chunk size is (mask + 1) bytes.
    // For a 1MB average, mask = 0xFFFFF (20 bits set).
    this.mask = this.avgChunkSize - 1;

    this.rollingHash = new RollingHash(48);
  }

  // Chunk a file buffer into an array of { content, hash, offset, size } objects.
  // Each chunk's hash is its SHA-256 digest, serving as its content-addressable key.
  chunkFile(fileBuffer) {
    const chunks = [];
    let chunkStart = 0;

    this.rollingHash.reset();

    for (let i = 0; i < fileBuffer.length; i++) {
      // Feed each byte into the rolling hash
      const hashValue = this.rollingHash.update(fileBuffer[i]);
      const chunkLength = i - chunkStart + 1;

      // Decide whether to cut a chunk boundary here.
      // Cut if: (1) minimum size is met AND hash hits the mask, OR
      //         (2) maximum size is reached (forced cut to prevent huge chunks)
      const hitBoundary = chunkLength >= this.minChunkSize
        && (hashValue & this.mask) === 0;
      const hitMaxSize = chunkLength >= this.maxChunkSize;

      if (hitBoundary || hitMaxSize) {
        // Extract the chunk bytes from the file buffer
        const chunkContent = fileBuffer.slice(chunkStart, i + 1);

        // Compute SHA-256 hash of the chunk content
        const chunkHash = crypto
          .createHash('sha256')
          .update(chunkContent)
          .digest('hex');

        chunks.push({
          content: chunkContent,      // Raw bytes of this chunk
          hash: chunkHash,            // SHA-256 content hash (storage key)
          offset: chunkStart,         // Byte offset in original file
          size: chunkContent.length   // Size in bytes
        });

        // Move to the start of the next chunk
        chunkStart = i + 1;
        this.rollingHash.reset();
      }
    }

    // Handle any remaining bytes after the last boundary as the final chunk.
    // This chunk may be smaller than minChunkSize, which is acceptable for
    // the tail end of a file.
    if (chunkStart < fileBuffer.length) {
      const chunkContent = fileBuffer.slice(chunkStart);
      const chunkHash = crypto
        .createHash('sha256')
        .update(chunkContent)
        .digest('hex');

      chunks.push({
        content: chunkContent,
        hash: chunkHash,
        offset: chunkStart,
        size: chunkContent.length
      });
    }

    return chunks;
  }
}

// ============================================================
// SECTION 3: Block Store with Deduplication
// ============================================================

class BlockStore {
  // Simulates content-addressable block storage (like S3 with hash keys).
  // In production, this would be backed by S3, Azure Blob, or GCS.
  // The key insight: using content hashes as keys means that storing
  // the same data twice is automatically a no-op.

  constructor() {
    this.blocks = new Map();       // hash -> { data, refCount, createdAt }
    this.totalBytes = 0;           // Total unique bytes stored
    this.totalBytesDeduped = 0;    // Bytes saved by deduplication
  }

  // Check if a block with the given hash already exists.
  // This is called before upload to implement client-side deduplication.
  has(hash) {
    return this.blocks.has(hash);
  }

  // Store a block. If the block already exists (same hash), increment
  // its reference count instead of storing a duplicate.
  // Returns true if the block was newly stored, false if it was a dedup hit.
  store(hash, data) {
    if (this.blocks.has(hash)) {
      // Block already exists — deduplication hit!
      // Just increment the reference count.
      const block = this.blocks.get(hash);
      block.refCount += 1;
      this.totalBytesDeduped += data.length;
      return false; // Not a new store
    }

    // Verify the hash matches the data (integrity check)
    const computedHash = crypto
      .createHash('sha256')
      .update(data)
      .digest('hex');

    if (computedHash !== hash) {
      throw new Error(
        `Hash mismatch: expected ${hash}, got ${computedHash}. ` +
        'Data may be corrupted.'
      );
    }

    // Store the new block
    this.blocks.set(hash, {
      data: Buffer.from(data),    // Store a copy of the data
      refCount: 1,                // Initial reference count
      createdAt: Date.now()       // Timestamp for storage tiering
    });

    this.totalBytes += data.length;
    return true; // Newly stored
  }

  // Retrieve a block by its hash. Returns the raw data buffer.
  // In production, this would be an S3 GET request.
  retrieve(hash) {
    const block = this.blocks.get(hash);
    if (!block) {
      throw new Error(`Block not found: ${hash}`);
    }
    return block.data;
  }

  // Decrement reference count. When it reaches 0, the block is eligible
  // for garbage collection.
  decrementRef(hash) {
    const block = this.blocks.get(hash);
    if (!block) return;

    block.refCount -= 1;
    if (block.refCount <= 0) {
      this.totalBytes -= block.data.length;
      this.blocks.delete(hash);
    }
  }

  // Return storage statistics for monitoring/debugging.
  getStats() {
    return {
      uniqueBlocks: this.blocks.size,
      totalBytesStored: this.totalBytes,
      totalBytesDeduped: this.totalBytesDeduped,
      dedupRatio: this.totalBytesDeduped > 0
        ? ((this.totalBytesDeduped / (this.totalBytes + this.totalBytesDeduped)) * 100).toFixed(1) + '%'
        : '0%'
    };
  }
}

// ============================================================
// SECTION 4: Metadata Store
// ============================================================

class MetadataStore {
  // Stores file metadata including path, chunk list, version history,
  // and permissions. In production, this would be a sharded MySQL/PostgreSQL
  // database with a Redis caching layer.

  constructor() {
    this.files = new Map();       // fileId -> metadata object
    this.pathIndex = new Map();   // "userId:filePath" -> fileId (for lookups)
    this.versions = new Map();    // fileId -> [version history entries]
  }

  // Generate a unique file ID (UUID v4 in production).
  _generateId() {
    return crypto.randomBytes(16).toString('hex');
  }

  // Create or update a file's metadata.
  // If the file exists and the baseVersion doesn't match, a conflict is detected.
  // Returns { success, fileId, version } or { conflict, serverVersion }.
  upsert(userId, filePath, chunkHashes, baseVersion) {
    const key = `${userId}:${filePath}`;
    const existingId = this.pathIndex.get(key);

    if (existingId) {
      // File exists — check for version conflict
      const existing = this.files.get(existingId);

      if (existing.version !== baseVersion) {
        // Conflict: the server's version has advanced beyond what the
        // client based its edit on.
        return {
          conflict: true,
          serverVersion: existing.version,
          serverChunks: existing.chunks
        };
      }

      // No conflict — save current version to history, then update
      if (!this.versions.has(existingId)) {
        this.versions.set(existingId, []);
      }
      this.versions.get(existingId).push({
        version: existing.version,
        chunks: [...existing.chunks],
        modifiedAt: existing.modifiedAt
      });

      // Update the file metadata to the new version
      existing.chunks = chunkHashes;
      existing.version += 1;
      existing.modifiedAt = Date.now();
      existing.modifiedBy = userId;

      return {
        success: true,
        fileId: existingId,
        version: existing.version
      };
    }

    // New file — create metadata record
    const fileId = this._generateId();
    const metadata = {
      fileId,
      userId,
      filePath,
      chunks: chunkHashes,
      version: 1,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      modifiedBy: userId,
      isDeleted: false
    };

    this.files.set(fileId, metadata);
    this.pathIndex.set(key, fileId);

    return { success: true, fileId, version: 1 };
  }

  // Retrieve the current metadata for a file.
  get(userId, filePath) {
    const key = `${userId}:${filePath}`;
    const fileId = this.pathIndex.get(key);
    if (!fileId) return null;

    return { ...this.files.get(fileId) };
  }

  // Retrieve the version history for a file.
  getVersionHistory(userId, filePath) {
    const key = `${userId}:${filePath}`;
    const fileId = this.pathIndex.get(key);
    if (!fileId) return [];

    return this.versions.get(fileId) || [];
  }
}

// ============================================================
// SECTION 5: Notification Service
// ============================================================

class NotificationService extends EventEmitter {
  // Manages real-time change notifications to connected clients.
  // In production, this would use WebSockets or long polling with
  // a message queue (Kafka) backend for reliability and scalability.

  constructor() {
    super();
    this.subscribers = new Map();  // userId -> Set of callback functions
    this.pendingEvents = new Map(); // userId -> queue of events (for offline users)
  }

  // Subscribe a client to receive change notifications for a user.
  // The callback is invoked with a change event whenever a file changes.
  subscribe(userId, callback) {
    if (!this.subscribers.has(userId)) {
      this.subscribers.set(userId, new Set());
    }
    this.subscribers.get(userId).add(callback);

    // Deliver any pending events that accumulated while the user was offline
    const pending = this.pendingEvents.get(userId);
    if (pending && pending.length > 0) {
      for (const event of pending) {
        callback(event);
      }
      this.pendingEvents.delete(userId);
    }

    // Return an unsubscribe function for cleanup
    return () => {
      const subs = this.subscribers.get(userId);
      if (subs) subs.delete(callback);
    };
  }

  // Publish a change event to all subscribers of the affected users.
  // If a user has no active subscribers (offline), queue the event.
  publish(event) {
    const { affectedUsers, ...eventData } = event;

    for (const userId of affectedUsers) {
      const subs = this.subscribers.get(userId);

      if (subs && subs.size > 0) {
        // User has active connections — deliver immediately
        for (const callback of subs) {
          // Wrap in try-catch so one failing callback doesn't block others
          try {
            callback({ ...eventData, userId });
          } catch (err) {
            console.error(`Notification delivery failed for ${userId}:`, err);
          }
        }
      } else {
        // User is offline — queue the event for later delivery
        if (!this.pendingEvents.has(userId)) {
          this.pendingEvents.set(userId, []);
        }
        this.pendingEvents.get(userId).push({ ...eventData, userId });
      }
    }

    // Emit on the service itself for monitoring/logging
    this.emit('change', event);
  }
}

// ============================================================
// SECTION 6: Sync Engine (Orchestrator)
// ============================================================

class SyncEngine {
  // The central orchestrator that coordinates chunking, deduplication,
  // metadata updates, and notifications. This is the "brain" of the
  // sync service, running on the server side.

  constructor() {
    this.chunkingEngine = new ChunkingEngine();
    this.blockStore = new BlockStore();
    this.metadataStore = new MetadataStore();
    this.notificationService = new NotificationService();
  }

  // Process a file upload from a client.
  // 1. Chunk the file using content-defined chunking.
  // 2. Determine which chunks need to be uploaded (deduplication check).
  // 3. Store new chunks in the block store.
  // 4. Update file metadata.
  // 5. Notify other devices.
  uploadFile(userId, filePath, fileBuffer, baseVersion = 0) {
    // Step 1: Chunk the file
    const chunks = this.chunkingEngine.chunkFile(fileBuffer);
    const chunkHashes = chunks.map(c => c.hash);

    // Step 2: Check which chunks already exist (deduplication)
    const newChunks = chunks.filter(c => !this.blockStore.has(c.hash));
    const existingCount = chunks.length - newChunks.length;

    // Step 3: Store only the new (non-duplicate) chunks
    for (const chunk of newChunks) {
      this.blockStore.store(chunk.hash, chunk.content);
    }

    // For existing chunks, increment their reference counts
    for (const chunk of chunks) {
      if (this.blockStore.has(chunk.hash) && !newChunks.includes(chunk)) {
        // The block already existed — the store method handles ref counting
        this.blockStore.store(chunk.hash, chunk.content);
      }
    }

    // Step 4: Update metadata (with conflict detection)
    const result = this.metadataStore.upsert(
      userId, filePath, chunkHashes, baseVersion
    );

    if (result.conflict) {
      return {
        success: false,
        conflict: true,
        message: `Conflict detected: server is at version ${result.serverVersion}, ` +
                 `but edit was based on version ${baseVersion}`,
        serverVersion: result.serverVersion,
        serverChunks: result.serverChunks
      };
    }

    // Step 5: Publish change notification
    this.notificationService.publish({
      type: 'FILE_CHANGED',
      filePath,
      version: result.version,
      changedBy: userId,
      chunkHashes,
      affectedUsers: [userId],  // In production, include shared folder members
      timestamp: Date.now()
    });

    return {
      success: true,
      fileId: result.fileId,
      version: result.version,
      chunksTotal: chunks.length,
      chunksNew: newChunks.length,
      chunksDeduped: existingCount,
      bytesUploaded: newChunks.reduce((sum, c) => sum + c.size, 0),
      bytesSaved: chunks
        .filter(c => !newChunks.includes(c))
        .reduce((sum, c) => sum + c.size, 0)
    };
  }

  // Download a file: retrieve metadata, then fetch and reassemble chunks.
  downloadFile(userId, filePath) {
    // Step 1: Get the current metadata
    const metadata = this.metadataStore.get(userId, filePath);
    if (!metadata) {
      return { success: false, message: 'File not found' };
    }

    // Step 2: Retrieve each chunk from block storage
    const chunkBuffers = metadata.chunks.map(hash => {
      return this.blockStore.retrieve(hash);
    });

    // Step 3: Concatenate chunks to reconstruct the complete file
    const fileBuffer = Buffer.concat(chunkBuffers);

    return {
      success: true,
      data: fileBuffer,
      metadata,
      totalChunks: metadata.chunks.length
    };
  }

  // Compute the diff between two versions of a file.
  // Returns which chunks need to be uploaded/downloaded to go from
  // oldVersion to newVersion.
  computeDiff(oldChunkHashes, newChunkHashes) {
    const oldSet = new Set(oldChunkHashes);
    const newSet = new Set(newChunkHashes);

    // Chunks in new but not in old = need to be uploaded/downloaded
    const added = newChunkHashes.filter(h => !oldSet.has(h));

    // Chunks in old but not in new = can be dereferenced
    const removed = oldChunkHashes.filter(h => !newSet.has(h));

    // Chunks in both = no transfer needed
    const unchanged = newChunkHashes.filter(h => oldSet.has(h));

    return { added, removed, unchanged };
  }
}

// ============================================================
// SECTION 7: Demonstration and Testing
// ============================================================

function runDemo() {
  console.log('=== File Storage and Sync Service Demo ===\n');

  const engine = new SyncEngine();

  // Create a test file (simulating a text document)
  const originalContent = Buffer.from(
    'The quick brown fox jumps over the lazy dog. '.repeat(50000)
    // ~2.2 MB of repeated text to demonstrate chunking
  );
  console.log(`Original file size: ${(originalContent.length / 1024).toFixed(1)} KB`);

  // Upload the original file
  console.log('\n--- Upload Original File ---');
  const upload1 = engine.uploadFile('user-1', '/docs/story.txt', originalContent, 0);
  console.log(`Result: ${JSON.stringify(upload1, null, 2)}`);

  // Modify the file (change text near the beginning)
  // With content-defined chunking, only the affected chunks will differ
  const modifiedContent = Buffer.from(
    'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG! '.repeat(100)
    + 'The quick brown fox jumps over the lazy dog. '.repeat(49900)
  );
  console.log(`\nModified file size: ${(modifiedContent.length / 1024).toFixed(1)} KB`);

  // Upload the modified version
  console.log('\n--- Upload Modified File ---');
  const upload2 = engine.uploadFile('user-1', '/docs/story.txt', modifiedContent, 1);
  console.log(`Result: ${JSON.stringify(upload2, null, 2)}`);

  // Upload the same file as a different user (cross-user deduplication)
  console.log('\n--- Upload Same File as Different User ---');
  const upload3 = engine.uploadFile('user-2', '/docs/copy.txt', originalContent, 0);
  console.log(`Result: ${JSON.stringify(upload3, null, 2)}`);

  // Demonstrate conflict detection
  console.log('\n--- Simulate Conflict ---');
  const conflictContent = Buffer.from(
    'CONFLICT VERSION: ' + 'The quick brown fox. '.repeat(50000)
  );
  // user-1's file is at version 2, but we claim base version 1 (stale)
  const conflictResult = engine.uploadFile(
    'user-1', '/docs/story.txt', conflictContent, 1
  );
  console.log(`Conflict result: ${JSON.stringify(conflictResult, null, 2)}`);

  // Download the file
  console.log('\n--- Download File ---');
  const download = engine.downloadFile('user-1', '/docs/story.txt');
  console.log(`Downloaded: ${download.success}, ` +
    `size: ${(download.data.length / 1024).toFixed(1)} KB, ` +
    `chunks: ${download.totalChunks}, ` +
    `version: ${download.metadata.version}`);

  // Verify integrity: downloaded content matches the last successful upload
  const contentMatch = modifiedContent.equals(download.data);
  console.log(`Content integrity check: ${contentMatch ? 'PASSED' : 'FAILED'}`);

  // Show version history
  console.log('\n--- Version History ---');
  const history = engine.metadataStore.getVersionHistory('user-1', '/docs/story.txt');
  console.log(`Versions stored: ${history.length}`);
  for (const ver of history) {
    console.log(`  Version ${ver.version}: ${ver.chunks.length} chunks, ` +
      `modified at ${new Date(ver.modifiedAt).toISOString()}`);
  }

  // Show deduplication statistics
  console.log('\n--- Block Store Statistics ---');
  console.log(JSON.stringify(engine.blockStore.getStats(), null, 2));

  // Demonstrate notification system
  console.log('\n--- Notification System ---');
  const unsubscribe = engine.notificationService.subscribe('user-1', (event) => {
    console.log(`  Notification received: ${event.type} for ${event.filePath} ` +
      `(version ${event.version})`);
  });

  // This upload will trigger the notification
  const notifyContent = Buffer.from('Final version. '.repeat(30000));
  engine.uploadFile('user-1', '/docs/story.txt', notifyContent, 2);

  // Clean up subscription
  unsubscribe();

  console.log('\n=== Demo Complete ===');
}

// Run the demonstration
runDemo();
```

The code above is structured in seven clearly separated sections. Section 1 implements the rolling hash, which is the mathematical foundation that makes content-defined chunking possible. The `RollingHash` class maintains a sliding window over the file's bytes, updating the hash in constant time as the window advances. This efficiency is critical — the hash must be computed at every byte position in the file, so anything more than O(1) per byte would be prohibitively slow for large files.

Section 2 builds on the rolling hash to implement the `ChunkingEngine`. The key logic is in `chunkFile`: for each byte, the rolling hash is updated, and if the hash meets the boundary condition (lowest bits are all zero) and the minimum chunk size has been reached, a chunk boundary is placed. The maximum chunk size acts as a safety valve to prevent pathologically large chunks. Each chunk is identified by its SHA-256 hash, which becomes its storage key.

Section 3 implements the `BlockStore`, our content-addressable storage layer. The `store` method is the core of deduplication: if a block with the same hash already exists, the store simply increments a reference count rather than storing duplicate data. The `retrieve` method fetches blocks by hash, and `decrementRef` handles cleanup when blocks are no longer needed.

Section 4 provides the `MetadataStore`, which tracks the authoritative state of every file. The `upsert` method is where conflict detection happens: it compares the client's base version against the server's current version, and if they diverge, it returns a conflict instead of silently overwriting. Version history is maintained by saving the old chunk list before updating to the new one.

Section 5 implements the `NotificationService` using an event-driven pattern. When a file changes, the service pushes events to all subscribed clients. If a client is offline, events are queued for delivery when the client reconnects. In production, this would be backed by a message queue like Kafka for durability and a WebSocket server for real-time delivery.

Section 6 ties everything together in the `SyncEngine`, which orchestrates the complete upload and download workflows. The `uploadFile` method performs chunking, deduplication, storage, metadata update, and notification in a single coordinated flow. The `computeDiff` method enables efficient delta sync by determining exactly which chunks differ between two versions.

Section 7 demonstrates the system in action: uploading a file, modifying it (showing that only changed chunks are stored), cross-user deduplication (showing that a second user uploading the same file stores zero new bytes), conflict detection, download with integrity verification, version history, and real-time notifications. Running this demo produces concrete output showing deduplication ratios, chunk counts, and bytes saved — the kind of metrics that matter in a real system.

---

### Section 12 — Connection to Next Topic

In this topic, we tackled the challenge of keeping files synchronized across devices — a problem fundamentally about ensuring that distributed copies of data converge to the same state despite concurrent modifications, network partitions, and offline operation. The core techniques we explored — chunking for efficient data transfer, content-addressable storage for deduplication, conflict resolution for concurrent edits, and real-time notifications for immediate propagation — are all instances of broader distributed systems patterns.

Topic 52 takes us from syncing static files to coordinating dynamic, real-time location data in a ride-sharing service like Uber. At first glance, these systems seem unrelated: one deals with documents sitting in folders, the other with cars moving through streets. But the underlying challenges are remarkably similar. Both systems must handle massive write throughput (file changes in Dropbox, location updates in Uber). Both require real-time propagation of state changes to interested parties (other devices in Dropbox, riders tracking their driver in Uber). Both must make trade-offs between consistency and availability (can a rider see a slightly stale driver location? can a user see a slightly stale file list?). And both must operate correctly despite unreliable networks (phones going through tunnels, laptops losing Wi-Fi).

The key shift is from data at rest to data in motion. In a file sync service, the state changes when a user explicitly modifies a file, perhaps a few times per hour. In a ride-sharing service, the state (driver locations) changes continuously — every few seconds for every active driver. This dramatically increases the write throughput requirements and makes traditional database approaches insufficient. Where Dropbox stores chunks in S3 and metadata in MySQL, Uber needs geospatial indexes that can handle millions of location updates per second and nearest-neighbor queries in real-time. The notification system also evolves: instead of notifying a user's devices of file changes, the system must match riders with nearby drivers and provide continuous location tracking. These are the challenges we will tackle in Topic 52, building on the distributed systems foundation established here and throughout the curriculum.

---
---

<!--
Topic: 52
Title: Design a Ride-Sharing Service (Uber/Lyft)
Section: 11 — Real-World Designs Part 3
Track: 0-to-100 Deep Mastery
Difficulty: Senior
Interview Weight: High
Prerequisites: Topics 1-3, 6, 10, 15, 25-26
Next Topic: Topic 53 — Design a Payment System
Estimated Read Time: 55-65 minutes
-->

## Topic 52: Design a Ride-Sharing Service (Uber/Lyft)

---

### Section 1 — Why This Design?

In December 2008, Travis Kalanick and Garrett Camp stood on a cold Paris street corner, unable to hail a cab. That frustration planted the seed for what would become one of the most disruptive technology companies of the 21st century. Camp purchased the domain UberCab.com in 2009, and by 2010, the first Uber ride was completed in San Francisco. The original pitch was deceptively simple: press a button, get a ride. But beneath that simplicity lay an engineering challenge of extraordinary depth — matching two moving entities in real time across a sprawling urban landscape, pricing the transaction dynamically, routing the vehicle efficiently, and processing a payment seamlessly, all within seconds.

Lyft, founded by Logan Green and John Zimmer in 2012, pushed the concept further by introducing the peer-to-peer model where everyday drivers could offer rides using their personal vehicles. This cemented the "gig economy" paradigm. Together, Uber and Lyft transformed urban transportation from a regulated medallion-based taxi monopoly into an on-demand, algorithm-driven marketplace. By 2024, Uber alone was processing over 28 million trips per day across 70+ countries, with roughly 5.4 million active drivers. The scale is staggering: millions of GPS pings per second, billions of routing calculations per day, and real-time pricing that shifts by the minute in thousands of micro-zones across the globe.

From a system design interview perspective, the ride-sharing problem is a goldmine because it tests nearly every major distributed systems concept simultaneously. You need geospatial indexing to find nearby drivers efficiently (Topic 25). You need real-time data pipelines to ingest millions of location updates per second (Topic 15). You need a matching algorithm that solves a constrained optimization problem under tight latency budgets. You need a state machine to manage the lifecycle of a trip through multiple stages with failure handling at each transition. You need surge pricing that responds to supply-demand imbalances in real time. You need a notification system that pushes updates to both riders and drivers with sub-second latency. And you need all of this to work at global scale with five-nines availability, because when someone is stranded at 2 AM, the system cannot afford downtime. This topic synthesizes concepts from geospatial data structures, real-time streaming, distributed coordination, and algorithmic optimization into one cohesive, interview-ready design.

---

### Section 2 — Requirements Gathering

**Functional Requirements**

The core user journey defines the functional surface area. A rider opens the app, sees their current location on a map, enters a destination, and receives a fare estimate. Upon confirming the ride request, the system matches them with a nearby available driver. The driver receives the request with pickup details and can accept or decline. Once accepted, both parties see each other's real-time location on the map. The driver navigates to the pickup point, confirms the rider is in the vehicle, and drives to the destination. Upon arrival, the fare is calculated, payment is processed automatically, and both parties rate each other. Beyond this core flow, riders need trip history, the ability to schedule rides in advance, the option to split fares, and safety features like trip sharing with trusted contacts and an emergency button. Drivers need an earnings dashboard, navigation integration, and the ability to set availability and preferred zones.

The system must support multiple ride types: economy (UberX), premium (Uber Black), shared rides (UberPool/Lyft Shared), and specialty vehicles (XL, wheelchair accessible). Each ride type has its own pricing model, vehicle requirements, and matching constraints. The ratings system must be bidirectional — riders rate drivers and drivers rate riders — with consequences for consistently low ratings (deactivation below 4.6 stars for drivers, for instance).

**Non-Functional Requirements**

Real-time performance is the defining non-functional constraint. The matching process — from ride request to driver notification — must complete within 30 seconds in the worst case, with a target of under 10 seconds for 95th percentile. Driver location updates must be ingested every 3-5 seconds to maintain accurate maps and ETAs. The ETA displayed to riders must be accurate within 2 minutes for 90% of trips. The system must achieve 99.99% availability (roughly 52 minutes of downtime per year), because ride-sharing is increasingly critical infrastructure — people depend on it to get to airports, hospitals, and job interviews. Surge pricing must react to demand changes within 1-2 minutes. Payment processing must be reliable and idempotent, handling network failures gracefully without double-charging.

Data consistency requirements are nuanced. A single ride must never be assigned to two drivers simultaneously (strong consistency for matching), but location data can tolerate eventual consistency (a 2-second-old driver position is acceptable). The system must handle regional failures gracefully — an outage in the US-East region should not affect riders in Europe.

**Back-of-Envelope Estimation**

Let us estimate the scale for a system comparable to Uber at peak maturity:

```
Active Drivers:         ~5 million globally
Daily Rides:            ~20 million
Peak Rides per Second:  ~500 (assuming 10x peak-to-average ratio)
  - 20M rides / 86,400 sec = ~230 rides/sec average
  - Peak: ~2,300 rides/sec (during rush hours in dense cities)

Location Updates:
  - 5M drivers sending updates every 4 seconds
  - 5,000,000 / 4 = 1,250,000 updates/sec (~1.25M GPS pings/sec)
  - Each update: driver_id (8B) + lat (8B) + lng (8B) + timestamp (8B)
    + heading (4B) + speed (4B) + status (1B) = ~41 bytes
  - Bandwidth: 1.25M * 41B = ~51 MB/sec = ~410 Mbps ingress

Trip Data Storage:
  - Each trip record: ~2 KB (IDs, timestamps, route, fare, ratings)
  - 20M trips/day * 2 KB = 40 GB/day = ~14.6 TB/year
  - Route polylines (detailed GPS trace): ~10 KB per trip
  - 20M * 10 KB = 200 GB/day for route data

ETA Calculations:
  - Each ride request triggers ETA calculations for ~10-50 nearby drivers
  - 2,300 peak requests/sec * 30 ETA calculations = ~69,000 ETA calculations/sec

Map Data:
  - Road network graph: ~1-2 GB per major metro area
  - Global road network: ~50-100 GB
  - Precomputed routing tables: ~500 GB per region
```

These numbers make it clear that the location ingestion pipeline is the highest-throughput component (over 1 million writes per second), while the matching and ETA services face the tightest latency requirements (sub-second decisions with complex computation).

---

### Section 3 — High-Level Architecture

The ride-sharing system decomposes into several major services, each responsible for a clearly bounded domain. At the outermost layer, the Rider App and Driver App communicate through an API Gateway that handles authentication, rate limiting, and request routing. Behind the gateway, the core services include the Ride Matching Service (the brain of the operation), the Location Service (tracking every driver in real time), the Trip Service (managing the lifecycle of each ride), the ETA Service (calculating arrival times using road network data), the Pricing Service (computing fares and surge multipliers), the Payment Service (charging riders and paying drivers), and the Notification Service (pushing real-time updates to mobile clients via WebSockets or server-sent events).

The Location Service is the highest-throughput component, ingesting over a million GPS updates per second from drivers. It writes to both an in-memory spatial index (for fast nearest-driver queries) and a Kafka-based pipeline (for downstream analytics, ETA training, and trip recording). The Ride Matching Service reads from the spatial index to find candidate drivers, scores them using the ETA Service, and dispatches the optimal match. The Trip Service maintains the state machine for each active trip, coordinating between rider actions, driver actions, and automated transitions (like auto-cancellation after timeout).

```
                         +------------------+
                         |   Rider Mobile   |
                         |      App         |
                         +--------+---------+
                                  |
                         +--------v---------+
                         |   API Gateway    |<--------+
                         | (Auth, Rate Limit|         |
                         |  Load Balancer)  |    +----+--------+
                         +----+----+----+---+    | Driver Mobile|
                              |    |    |        |     App      |
              +---------------+    |    +-----+  +--------------+
              |                    |          |
     +--------v------+  +---------v---+  +---v-----------+
     | Ride Matching  |  | Trip Service|  | Location      |
     | Service        |  | (Lifecycle) |  | Service       |
     | (Dispatch)     |  +------+------+  | (GPS Ingest)  |
     +---+-----+------+        |          +---+-----+-----+
         |     |                |              |     |
         |     |          +-----v------+       |     |
         |     |          | Payment    |       |     |
         |     |          | Service    |       |     |
         |     |          +------------+       |     |
         |     |                               |     |
    +----v---+ +----v-----+   +----------------v-+   |
    | ETA    | | Pricing  |   | Spatial Index     |   |
    | Service| | Service  |   | (In-Memory Grid)  |   |
    +----+---+ | (Surge)  |   +-------------------+   |
         |     +----------+                            |
         |                                    +--------v--------+
    +----v--------------+                     |  Kafka / Stream  |
    | Road Network Graph|                     |  Pipeline        |
    | (Routing Engine)  |                     +--------+---------+
    +-------------------+                              |
                                              +--------v---------+
                                              | Analytics / ML   |
                                              | (Demand Predict, |
                                              |  ETA Training)   |
                                              +------------------+

    +-------------------+     +-------------------+
    | Notification      |     | User/Driver       |
    | Service           |     | Profile Service   |
    | (WebSocket/Push)  |     | (Ratings, History)|
    +-------------------+     +-------------------+
```

The data stores behind these services are purpose-selected. The Location Service uses Redis or an in-memory spatial index for real-time queries and Cassandra or DynamoDB for historical location trails. The Trip Service uses PostgreSQL (for strong consistency on active trips) with completed trips archived to a columnar store. The Pricing Service caches surge multipliers in Redis with a TTL of 1-2 minutes. The road network graph lives in a specialized routing engine (like OSRM or Valhalla) that can answer shortest-path queries in milliseconds. Kafka acts as the central nervous system, decoupling high-throughput location writes from downstream consumers.

---

### Section 4 — Deep Dive: Geospatial Indexing

The fundamental query that powers a ride-sharing service is deceptively simple: "Find all available drivers within X kilometers of this rider." At the scale of millions of active drivers, a naive approach — computing the Haversine distance from the rider to every single driver — would require millions of distance calculations per request. At 2,300 requests per second during peak, that is billions of computations per second. Geospatial indexing solves this by organizing driver locations into spatial data structures that allow efficient range queries.

**Geohashing**

Geohashing encodes a latitude/longitude pair into a string by recursively bisecting the world into grid cells. At each level, the latitude range is split in half (assigning a 0 or 1 bit depending on which half the point falls in), and the longitude range is similarly split. These bits are interleaved and encoded in base-32. The resulting string has a powerful prefix property: two points that share a longer common prefix are closer together geographically. A geohash of precision 6 (e.g., "9q8yyk") represents a cell roughly 1.2 km x 0.6 km, which is a useful granularity for finding nearby drivers in an urban setting.

To find drivers near a rider, you compute the rider's geohash, then look up all drivers in the same cell and in all 8 neighboring cells (to handle edge effects at cell boundaries). This turns a spatial range query into a set of simple string-prefix lookups, which are extremely efficient in key-value stores or sorted indices. The downside of geohashing is that cells are rectangular and have discontinuities at certain boundaries — two points very close together can end up in non-adjacent geohash cells near the edges of major grid divisions (for example, near the equator or the prime meridian). The 8-neighbor search mitigates but does not fully eliminate this issue.

In practice, you would maintain a data structure like a Redis sorted set or a hash map keyed by geohash prefix. When a driver sends a location update, you compute their new geohash, remove them from their old cell, and insert them into the new one. For a precision-6 geohash, there are roughly 32^6 = ~1 billion possible cells globally, but only a small fraction are occupied at any time.

**Quadtree**

A quadtree is a tree-based spatial data structure that recursively divides a two-dimensional space into four quadrants. Starting from a bounding box encompassing the entire area of interest (say, a single city or the whole globe), each node in the tree represents a rectangular region. When the number of points in a region exceeds a threshold (e.g., 100 drivers), the region is subdivided into four children. This creates an adaptive grid — dense urban areas get finely subdivided while sparse rural areas remain coarse.

Range queries on a quadtree start at the root and recursively visit only those child nodes whose bounding boxes intersect with the search radius. This prunes the search space dramatically. Insertions and deletions (when drivers move) require finding the appropriate leaf, potentially splitting or merging nodes. The main advantage of quadtrees over geohashing is their adaptivity: they naturally adjust resolution to data density. The downside is that quadtrees are more complex to implement in a distributed setting — a single quadtree must either fit in memory on one machine or be partitioned across machines with careful coordination.

**S2 Geometry (Google's Approach)**

Google's S2 geometry library projects the Earth's surface onto a unit cube, then maps each face of the cube onto a Hilbert curve. The Hilbert curve is a space-filling curve that traverses every point in a 2D area while preserving locality — nearby points on the curve tend to be nearby in space. Each cell on the S2 hierarchy is identified by a 64-bit integer, and the hierarchy has 30 levels of subdivision. The cell at level 12 is roughly 3.3 km^2, while level 16 is roughly 0.003 km^2.

The Hilbert-curve mapping means that a range query can be expressed as a small set of cell-ID ranges on a one-dimensional axis, which is extraordinarily efficient for database range scans. S2 cells are also more uniform in area than geohash cells (which distort near the poles), and they do not suffer from the boundary discontinuities of geohashing. Google uses S2 extensively in Google Maps, and it is the foundation for many large-scale geospatial systems.

**H3 (Uber's Approach)**

Uber developed H3, a hexagonal hierarchical spatial index, specifically to address the needs of ride-sharing. Unlike the square or rectangular cells of geohashing and S2, H3 uses hexagons. Hexagons have a crucial geometric property: every neighbor is equidistant from the center (unlike squares, where corner neighbors are farther than edge neighbors). This makes hexagons ideal for analyzing spatial proximity — the "find nearby drivers" problem is naturally expressed as "find all drivers in this hexagon and its ring of 6 neighbors."

H3 provides 16 resolutions, from resolution 0 (cells of ~4,357 km^2) to resolution 15 (cells of ~0.9 m^2). For ride-sharing, resolution 7 (~5.16 km^2) works well for surge pricing zones, and resolution 9 (~0.105 km^2, about a city block) works for fine-grained driver lookup. The hierarchy allows aggregation: you can quickly roll up statistics from resolution 9 cells to resolution 7 zones to compute surge multipliers. Each H3 cell is encoded as a 64-bit integer, enabling efficient storage and indexing.

**Trade-Off Summary**

```
+----------------+----------+----------+---------+----------+
| Approach       | Boundary | Uniform  | Dist.   | Industry |
|                | Issues   | Areas    | Friendly| Usage    |
+----------------+----------+----------+---------+----------+
| Geohash        | Yes      | No (pole | Easy    | Moderate |
|                | (edges)  | distort) | (string)|          |
+----------------+----------+----------+---------+----------+
| Quadtree       | No       | Adaptive | Hard    | Moderate |
|                |          | (density)|         |          |
+----------------+----------+----------+---------+----------+
| S2 Geometry    | Minimal  | Yes      | Good    | Google   |
|                |          | (Hilbert)| (int64) |          |
+----------------+----------+----------+---------+----------+
| H3 (Hexagonal) | No       | Yes      | Good    | Uber     |
|                | (equidist| (hex)    | (int64) |          |
+----------------+----------+----------+---------+----------+
```

For an interview, recommending geohashing is the safest and most commonly understood choice. It is simple to explain, easy to implement on top of Redis or DynamoDB, and sufficient for most scale requirements. Mention H3 or S2 as a "level-up" to demonstrate depth.

---

### Section 5 — Ride Matching Algorithm

The matching problem in ride-sharing is a constrained optimization problem: given a set of ride requests and a set of available drivers, assign each request to a driver in a way that minimizes total wait time while respecting constraints (driver availability, vehicle type, rider preferences). At first glance, it seems simple — just find the closest driver. But the closest driver by straight-line distance may not be the closest by road travel time. The closest driver by travel time may be about to become unavailable (ending their shift). And greedily assigning the closest driver to each request in sequence may produce a globally suboptimal assignment.

**Nearest-Available Driver (Greedy Approach)**

The simplest matching algorithm, and the one Uber originally used, is greedy nearest-available. When a ride request arrives, the system queries the spatial index for the K nearest available drivers (say, K=10), computes the ETA from each driver to the pickup point using the routing engine, and dispatches the ride offer to the driver with the lowest ETA. If that driver declines or does not respond within 15 seconds, the offer goes to the next driver on the list.

This approach is easy to implement and reason about, and it works well when supply exceeds demand. Its weakness emerges under constrained supply: assigning the nearest driver to Request A might leave Request B with a much longer wait, even though Request B could have been served by that same driver with only slightly more delay while Request A had another equally close driver. The greedy approach optimizes locally (minimizing wait time for the current request) at the expense of global efficiency.

**Batch Matching (Global Optimization)**

Uber transitioned to batch matching around 2015-2016 to address the greedy algorithm's limitations. Instead of matching each request immediately upon arrival, the system collects all requests and all available drivers over a short time window (typically 2-4 seconds) and solves a global optimization problem. The objective is to minimize the total (or maximum) wait time across all requests in the batch.

This is formulated as a bipartite matching problem: riders on one side, drivers on the other, with edge weights representing ETAs. The Hungarian algorithm solves this optimally in O(n^3) time, which is feasible for batch sizes of a few hundred. For larger batches, approximation algorithms or auction-based approaches are used. The batching window introduces a small additional delay (2-4 seconds), but the improved global assignment quality typically reduces average wait times by 10-20% compared to greedy matching, particularly during high-demand periods.

**ETA-Based Matching**

The match score for each driver-request pair should incorporate more than just geographic distance. Factors include: the ETA from the driver's current position to the pickup point (accounting for traffic, road network, and turn penalties); the driver's heading (a driver already moving toward the pickup is preferred over one moving away, even if both are equidistant); the driver's current trip status (a driver about to complete a trip in the right area can be "pre-matched" to the next request); and the rider's destination (in a pooling context, matching riders with overlapping routes). Uber calls this "forward dispatch" — assigning a new ride to a driver who is 2 minutes away from completing their current ride, so there is no idle gap.

**Supply-Demand Balancing**

In regions where demand exceeds supply, the matching algorithm must triage. Not every request can be fulfilled immediately. The system may: extend the search radius (accepting longer ETAs), activate surge pricing to reduce demand and attract more drivers, or implement a queue with estimated wait times. Conversely, in oversupplied areas, the system may encourage drivers to relocate to high-demand zones by displaying heat maps or offering incentive bonuses.

**Driver Acceptance and Rejection Flow**

When a ride offer is dispatched to a driver, the driver has a limited window (typically 15-30 seconds) to accept. If the driver does not respond, the offer times out and is sent to the next candidate. If the driver explicitly declines, the system records this and may adjust the driver's future matching priority (consistently declining offers can lead to warnings or temporary pauses). After a configurable number of failed dispatch attempts (e.g., 3-5), the system informs the rider that no drivers are available and suggests retrying or trying a different ride type.

This entire flow must be resilient to network issues. A driver's acceptance must be idempotent — if the network drops and the driver taps "accept" twice, the system should not create duplicate assignments. The matching service must also handle race conditions: if two requests simultaneously compete for the same driver, exactly one must win. This is typically enforced with an atomic compare-and-swap on the driver's status (available -> matched) using a distributed lock or an optimistic concurrency control mechanism.

---

### Section 6 — Real-Time Location Tracking

The location tracking subsystem is the circulatory system of a ride-sharing service. Every active driver's phone continuously reports its GPS coordinates — latitude, longitude, heading, and speed — to the server every 3-5 seconds. This data serves multiple purposes: it powers the spatial index for matching, enables real-time map visualization for riders and drivers, feeds the ETA calculation engine, generates the trip route polyline for fare calculation and dispute resolution, and provides training data for machine learning models that predict demand and optimize routing.

**Location Ingestion Pipeline**

At 1.25 million updates per second, the location ingestion pipeline must be designed for extreme throughput. A synchronous write to a database for each update is infeasible. Instead, the architecture uses Apache Kafka (or a similar distributed log) as the ingestion buffer. Driver apps send location updates to a fleet of stateless ingestion servers behind a load balancer. Each ingestion server validates the update (checking for reasonable GPS coordinates, rejecting obvious anomalies like locations in the ocean), enriches it with metadata (city, zone, driver status), and publishes it to a Kafka topic partitioned by geographic region or driver ID.

Multiple consumers read from the Kafka topic in parallel. The spatial index consumer updates the in-memory grid (or geohash table) that powers nearest-driver queries. The trip tracking consumer appends the update to the active trip's route polyline. The analytics consumer writes to a data warehouse for demand forecasting and ETA model training. The notification consumer pushes the driver's position to the rider's app via a WebSocket connection. By decoupling ingestion from processing via Kafka, each consumer can scale independently, and a slow consumer (like analytics) does not block the critical-path consumers (like the spatial index).

```
Driver App (GPS)
      |
      v
+------------------+       +------------------+
| Ingestion Server |------>| Kafka Topic      |
| (validate,       |       | (partitioned by  |
|  enrich, publish)|       |  region/driver)  |
+------------------+       +--------+---------+
                                    |
                    +---------------+---------------+
                    |               |               |
             +------v-----+  +-----v------+  +-----v-------+
             | Spatial     |  | Trip Route |  | Analytics   |
             | Index       |  | Consumer   |  | Consumer    |
             | Consumer    |  | (append to |  | (write to   |
             | (update     |  |  polyline) |  |  warehouse) |
             |  in-memory  |  +------------+  +-------------+
             |  grid)      |
             +-------------+
```

**Location Storage**

The in-memory spatial index stores only the most recent location for each active driver. With 5 million drivers, each entry consuming roughly 50 bytes, the total memory requirement is about 250 MB — easily fitting on a single machine, but typically sharded across multiple servers for fault tolerance and read throughput. The spatial index is rebuilt from Kafka on restart (or from a periodic snapshot in Redis), making it ephemeral and recoverable.

Historical location data — the complete trail of every driver's movements — is stored in a time-series-optimized store like Apache Cassandra or Amazon DynamoDB. The partition key is the driver ID, and the sort key is the timestamp. This enables efficient retrieval of a driver's trajectory for a specific trip or time range. With 1.25M updates/sec at 41 bytes each, this amounts to roughly 4.4 TB per day of raw location data. Retention policies (e.g., keeping detailed data for 90 days, then downsampling to per-minute resolution) are essential to manage storage costs.

**Map Matching**

Raw GPS coordinates from a phone are noisy. A driver traveling down a highway might report positions that oscillate between the highway and a parallel service road, or that briefly appear to be in a building adjacent to the road. Map matching is the process of snapping these raw GPS points onto the most likely road segment in the road network graph. Algorithms like the Hidden Markov Model (HMM) approach consider the sequence of GPS points, the road network topology, and the vehicle's speed to determine the most probable path. Accurate map matching is critical for fare calculation (which depends on actual road distance traveled), turn-by-turn navigation, and ETA estimation.

**ETA Calculation**

ETA (Estimated Time of Arrival) is the most visible metric to riders — it is displayed at the moment of booking and continuously updated during the trip. The ETA engine combines a road network graph (with time-dependent edge weights reflecting traffic conditions) with a shortest-path algorithm. For real-time queries, a modified Dijkstra's algorithm or A* search computes the fastest route. To achieve sub-millisecond query times at the scale of thousands of requests per second, most systems use precomputed routing structures like Contraction Hierarchies (CH). A CH preprocesses the road graph by contracting unimportant nodes and adding shortcut edges. Query time drops from seconds (for Dijkstra on a raw graph) to microseconds.

Historical traffic data is layered on top: the system knows that a particular highway segment is slow between 8-9 AM on weekdays, and incorporates this into the edge weights. Real-time traffic data from driver GPS traces provides further refinement. Uber's ETA model also incorporates machine learning features: weather conditions, local events, time of day, and even the specific pickup location's accessibility (e.g., a complex apartment building adds 2-3 minutes of pickup time).

---

### Section 7 — Surge Pricing

Surge pricing (Uber calls it "surge," Lyft calls it "Prime Time") is one of the most controversial and technically interesting components of a ride-sharing system. When demand for rides exceeds the supply of available drivers in a particular area, the system increases prices. This serves two economic functions: it discourages price-sensitive riders from requesting rides (reducing demand) and it incentivizes drivers to relocate to the high-demand area (increasing supply). The market-clearing price is dynamically computed and can change every 1-2 minutes.

**Supply-Demand Imbalance Detection**

The system continuously monitors supply (available drivers) and demand (ride requests) at a granular geographic level. Using the H3 or geohash grid, each cell has a real-time supply count and a demand rate (requests per minute). When the demand-to-supply ratio exceeds a threshold (say, 1.5:1), the cell is flagged for surge pricing. The detection must be smoothed — a momentary spike from a burst of requests should not trigger surge unless the imbalance persists for at least 30-60 seconds, to avoid oscillation (surge activates, demand drops, surge deactivates, demand spikes again).

**Dynamic Pricing Algorithm**

The surge multiplier is typically a function of the demand-to-supply ratio, calibrated by empirical price elasticity data. A simple model:

```
surge_multiplier = base + alpha * (demand_rate / supply_count - threshold)
```

Where `base` is 1.0 (no surge), `alpha` is a tuning parameter, and `threshold` is the ratio below which surge does not activate. In practice, the model is more sophisticated, incorporating predictive elements (if a concert is ending in 15 minutes, pre-position surge before the demand materializes), geographic smoothing (a surging cell should influence adjacent cells to prevent sharp price boundaries), and caps (regulatory or self-imposed maximum multipliers, e.g., 5x or 8x).

Uber disclosed that their pricing models use machine learning to predict a rider's willingness to pay for a specific trip at a specific time, which goes beyond simple supply-demand balancing into personalized pricing. This has drawn significant regulatory scrutiny and is worth mentioning in an interview as an ethical consideration.

**Geospatial Surge Zones**

Surge operates at the level of geographic zones, not individual rides. The system divides each city into zones (hexagonal cells at H3 resolution 7, or similar) and computes a surge multiplier for each zone independently. When a rider's pickup falls within a surge zone, the multiplier is applied to their fare estimate. The zone boundaries must be carefully designed: too coarse and surge is applied unfairly to riders in low-demand pockets within a broadly surging area; too fine and the system becomes noisy and hard for riders to understand.

A well-designed surge visualization shows the rider a heat map of surge zones so they can make an informed decision: walk two blocks to escape the surge zone, wait 10 minutes for it to subside, or accept the higher price. This transparency is both a user experience best practice and increasingly a regulatory requirement.

**Anti-Gaming Measures**

Surge pricing creates incentives for manipulation. Drivers might collude to artificially reduce supply by going offline simultaneously, triggering surge and then going back online at the inflated price. Riders might use automation to monitor surge and request rides the instant it drops. The system defends against these behaviors by: detecting coordinated driver offline events and excluding them from surge calculations; rate-limiting and CAPTCHAs on ride requests during surge transitions; and smoothing surge transitions to prevent exploitable sharp edges.

**Ethical Considerations**

Surge pricing during emergencies (natural disasters, terrorist attacks) has generated intense public backlash and regulatory action. Most ride-sharing companies now cap or disable surge during declared emergencies. An interview discussion of surge pricing should acknowledge this tension: the economic argument for surge (it actually increases supply when it is most needed) versus the fairness argument (it exploits desperate people). A mature answer mentions the solution: capped surge with driver incentive bonuses funded by the platform rather than passed to riders.

---

### Section 8 — Trip Lifecycle

Every ride in the system follows a well-defined lifecycle that can be modeled as a finite state machine. The state machine ensures that transitions are valid (you cannot go from "requested" directly to "completed"), that cancellations are handled correctly at each stage, and that the system can recover from failures (if a service crashes, it can reconstruct the trip's state from the database and resume).

**State Machine**

```
                             +------------+
                             |  REQUESTED |
                             +-----+------+
                                   |
                        (matching algorithm assigns driver)
                                   |
                             +-----v------+
                             |  MATCHED   |
                             +-----+------+
                                   |
                        (driver taps "accept")
                                   |
                             +-----v------+
                             |  ACCEPTED  |
                             +-----+------+
                                   |
                        (driver arrives at pickup)
                                   |
                             +-----v------+
                             |  ARRIVING  |
                             +-----+------+
                                   |
                        (driver confirms rider is in vehicle)
                                   |
                             +-----v------+
                             | IN_PROGRESS|
                             +-----+------+
                                   |
                        (driver arrives at destination)
                                   |
                             +-----v------+
                             | COMPLETED  |
                             +-----+------+
                                   |
                        (fare calculated, payment processed)
                                   |
                             +-----v------+
                             |   PAID     |
                             +-----+------+
                                   |
                        (both parties rate each other)
                                   |
                             +-----v------+
                             |   RATED    |
                             +------------+

  Cancellation edges (any of these states can transition to CANCELLED):
  - REQUESTED -> CANCELLED (rider cancels before match)
  - MATCHED   -> CANCELLED (driver declines / timeout)
  - ACCEPTED  -> CANCELLED (rider or driver cancels, possible fee)
  - ARRIVING  -> CANCELLED (rider no-show after timeout, cancellation fee)
```

**Handling Each Transition**

The REQUESTED to MATCHED transition is driven by the matching algorithm. The system stores the ride request in a persistent queue (e.g., a database table with status "requested") and triggers the matching service. If no driver is found within a timeout (e.g., 60 seconds), the request transitions to CANCELLED with a "no drivers available" reason.

The MATCHED to ACCEPTED transition involves a push notification to the driver with ride details. The driver has 15-30 seconds to accept. The system must handle the case where the driver's app is backgrounded or the phone has poor connectivity. If the driver does not accept, the request cycles back to the matching service for the next candidate. After a configurable number of failed attempts, the rider is notified.

The ACCEPTED to ARRIVING transition is based on the driver's proximity to the pickup point. When the driver is within a threshold distance (e.g., 100 meters), the app prompts the driver to confirm arrival. A countdown timer starts (typically 5 minutes); if the rider does not appear, the driver can cancel with a no-show fee charged to the rider.

The ARRIVING to IN_PROGRESS transition is the most critical for fare calculation. This is the moment the meter starts. The driver confirms that the rider is in the vehicle, and the system begins recording the route for distance-based fare computation. GPS tracking switches to high-frequency mode (every 1-2 seconds instead of 3-5) for accurate distance measurement.

The IN_PROGRESS to COMPLETED transition is triggered when the driver arrives at the destination and confirms drop-off. The system calculates the fare based on distance traveled, time elapsed, base fare, and any surge multiplier. This fare is then sent to the payment service.

**Safety Features**

Modern ride-sharing systems include several safety mechanisms integrated into the trip lifecycle. Trip sharing allows riders to share their real-time trip status (route, ETA, driver details) with trusted contacts via a link. An emergency button (accessible at any trip state) contacts local emergency services and shares the rider's location. Unexpected stop detection alerts the rider if the driver deviates significantly from the expected route. Photo verification (comparing the driver's photo to a real-time selfie) can be required at shift start to prevent unauthorized drivers. All of these features are implemented as event-driven hooks on state transitions and location updates within the trip lifecycle.

---

### Section 9 — Trade-Offs and Design Decisions

**Geohash vs. Quadtree vs. S2/H3**

Geohashing is the simplest to implement and explain. It works well with key-value stores (Redis, DynamoDB) because spatial proximity maps to string-prefix similarity. Its rectangular cells and boundary discontinuities are manageable with the 8-neighbor search pattern. Choose geohashing if you need simplicity and your system runs on commodity infrastructure. Quadtrees excel when driver density varies dramatically across regions (dense downtown vs. sparse suburbs) because they adaptively subdivide only where needed. However, they are harder to distribute across machines. S2 and H3 offer the best geometric properties (uniform cells, no discontinuities) but require specialized libraries and are harder to explain in an interview. Choose S2/H3 if you are designing for Uber-scale global deployment and need precise geographic analysis. In an interview, starting with geohashing and then mentioning H3 as an improvement demonstrates both practical knowledge and depth.

**Nearest-Available vs. Batch Matching**

Greedy nearest-available matching is simpler, has lower latency (no batching delay), and is sufficient when supply is abundant. It is the right choice for a v1 system or a market where drivers significantly outnumber riders. Batch matching shines in supply-constrained markets, during surge, or in rideshare/pool scenarios where multiple riders need to be matched to a single vehicle optimally. The 2-4 second batching delay is imperceptible to riders (who are already waiting for a driver) but can yield 10-20% improvements in average wait time. In an interview, propose greedy as the initial approach and batch matching as the optimization.

**Real-Time vs. Periodic Location Updates**

Sending GPS updates every 3-5 seconds balances accuracy against bandwidth and battery consumption. More frequent updates (every 1 second) provide smoother map animations and more accurate fare calculations but triple the ingestion throughput requirement and drain the driver's phone battery faster. Less frequent updates (every 10-15 seconds) reduce load but make ETAs less accurate and map visualization jerky. The 3-5 second interval is an industry-standard compromise. During active trips, the frequency can be increased to 1-2 seconds for accurate metering, then reduced when the driver is idle.

**Centralized vs. Regional Architecture**

A fully centralized architecture (all services in a single region) is simpler to build and reason about but creates a single point of failure and introduces high latency for users far from the data center. A regional architecture (separate deployments in US-East, EU-West, APAC, etc.) provides lower latency and fault isolation but introduces complexity for cross-region features (e.g., a user who travels internationally and expects their account to work seamlessly). The standard approach is regional deployment with a global user profile service: ride matching, location tracking, and trip management run in the rider's local region, while user accounts, payment methods, and trip history are globally replicated.

**Precomputed vs. Real-Time ETAs**

Precomputing ETAs for all possible origin-destination pairs is infeasible (the number of pairs is O(n^2) over millions of road network nodes). Instead, systems use precomputed routing structures (Contraction Hierarchies or similar) that allow real-time ETA queries in microseconds. The routing structure is precomputed and updated periodically (hourly or daily) with new traffic patterns, while real-time traffic overlays adjust edge weights on the fly. This hybrid approach gives the accuracy of real-time data with the speed of precomputed structures. In an interview, explain that you precompute the graph structure but query it in real time with dynamic weights.

---

### Section 10 — Interview Questions

**Beginner Tier**

**Q1: How would you find the nearest available drivers to a rider?**

Model Answer: I would use geohashing to encode each driver's latitude and longitude into a geohash string of precision 6 (roughly 1.2 km x 0.6 km cells). All active drivers are stored in a hash map keyed by their geohash prefix. When a rider requests a ride, I compute the rider's geohash and look up drivers in the same cell plus all 8 neighboring cells. This gives a candidate set within roughly a 2-3 km radius. I then compute the Haversine distance (or better, the road-network ETA) from the rider to each candidate and sort by proximity. The key insight is that geohashing converts a 2D spatial query into a set of 1D string-prefix lookups, which are O(1) in a hash map. For storage, Redis works well because it supports efficient hash operations and can handle the update throughput. When a driver moves to a new geohash cell, we remove them from the old cell and insert into the new one. The entire lookup operation takes under 10 milliseconds.

**Q2: What happens if a driver does not accept a ride request?**

Model Answer: When the matching service dispatches a ride offer to a driver, it starts a countdown timer (typically 15 seconds). If the driver does not respond within that window, the offer expires. The system then dispatches the offer to the next-best candidate from the precomputed candidate list (sorted by ETA). If the original candidate list is exhausted (e.g., 5 drivers were tried and all declined or timed out), the system expands the search radius and recomputes candidates. After a configurable maximum number of attempts (e.g., 5-8), if no driver accepts, the rider is notified that no drivers are available. Throughout this process, the ride remains in REQUESTED state. Each failed dispatch is logged for analytics — if a driver consistently declines, the system may reduce their matching priority or display warnings. The timeout mechanism must handle network partitions gracefully: if the driver accepted but the ACK was lost, the system should not assign the ride to a second driver simultaneously. This is enforced with a distributed lock on the ride ID and optimistic concurrency control on the driver's status field.

**Q3: How would you calculate the fare for a completed trip?**

Model Answer: The fare is calculated when the trip transitions from IN_PROGRESS to COMPLETED. The components are: a base fare (fixed amount, e.g., $2.50), a per-mile charge (distance-based, e.g., $1.75/mile), a per-minute charge (time-based, e.g., $0.35/minute), a booking fee (platform fee, e.g., $2.00), and a surge multiplier (applied to the distance and time components). The distance is computed by summing the GPS-traced route segments recorded during the trip, after map-matching to road segments. The time is the wall-clock duration from pickup confirmation to drop-off confirmation. The formula is: fare = booking_fee + surge_multiplier * (base_fare + per_mile_rate * distance_miles + per_minute_rate * time_minutes). Minimum fare thresholds (e.g., $7.00) apply. Tolls detected along the route are added at cost. For shared rides, the fare is discounted and split among passengers based on the fraction of the route they share.

**Mid-Level Tier**

**Q4: How would you design the location ingestion pipeline to handle 1 million+ updates per second?**

Model Answer: The pipeline has three stages: ingestion, buffering, and consumption. Ingestion servers are stateless HTTP endpoints behind a load balancer. Each server receives a batch of location updates from driver apps (batching on the client side — aggregating 3-4 updates into a single HTTP request — reduces connection overhead). The server validates coordinates (rejecting out-of-range values), compresses the payload, and publishes to Apache Kafka. Kafka is configured with a topic partitioned by geographic region (e.g., 50 partitions for 50 metro areas), ensuring that updates for the same region go to the same partition for ordered processing. Each partition achieves roughly 100K messages/sec, so 50 partitions handle 5M messages/sec with headroom.

On the consumer side, separate consumer groups handle different concerns independently. The spatial-index consumer reads from all partitions and updates the in-memory geohash grid. Because the grid is sharded by region, each consumer instance handles one region's updates. The trip-tracking consumer appends updates to the active trip's route polyline in Cassandra. The analytics consumer writes to S3 or a data lake for batch processing. Back-pressure is handled by Kafka's consumer lag monitoring — if the spatial-index consumer falls behind, alerts trigger auto-scaling of consumer instances. The critical design choice is separating the hot path (spatial index update, which must be real-time) from the warm path (trip recording, which can tolerate 1-2 seconds of delay) and the cold path (analytics, which can tolerate minutes of delay).

**Q5: Explain how batch matching improves over greedy nearest-driver matching.**

Model Answer: Consider a scenario with 3 riders (A, B, C) and 3 drivers (X, Y, Z). Greedy matching processes riders sequentially. Rider A requests first; the nearest driver is X (3 min ETA), so X is assigned. Rider B requests next; the nearest remaining driver is Z (7 min ETA), since Y is slightly farther. Rider C gets Y (8 min ETA). Total wait: 3 + 7 + 8 = 18 minutes. Batch matching collects all three requests over a 2-second window and considers all possible assignments simultaneously. It discovers that assigning X to B (4 min), Y to A (4 min), and Z to C (5 min) yields a total wait of 13 minutes — a 28% improvement. The algorithm formulates this as a minimum-weight bipartite matching problem, computable via the Hungarian algorithm in O(n^3) time or via approximate methods for larger batches.

The trade-off is the 2-second batching delay: every rider waits an additional 2 seconds before their request is processed. But since the matching process itself takes 5-10 seconds after that, the additional delay is negligible. Batch matching is most impactful during high demand when many requests arrive simultaneously. During low demand (1 request per batch), it degenerates to greedy matching naturally. Implementation requires a time-windowed buffer (collect requests for 2 seconds), a matrix of ETA scores (each request to each available driver), and a matching solver. The solver must complete within the latency budget (under 100ms for a batch of 50 requests), which the Hungarian algorithm achieves easily.

**Q6: How would you design the system to handle driver location updates during network instability?**

Model Answer: Network instability is common — drivers pass through tunnels, dead zones, or congested cell towers. The driver app must handle this gracefully with client-side buffering. When the app detects that it cannot reach the server (HTTP timeout or connection refused), it buffers location updates locally in memory or on disk. When connectivity resumes, the app sends the buffered updates in a batch with their original timestamps. The server processes these delayed updates by inserting them into the historical trail (Cassandra write with the original timestamp as the sort key) but does not use stale locations to update the real-time spatial index (which should always reflect the most recent known position).

On the server side, each driver's entry in the spatial index includes a "last_update_timestamp." If the timestamp is more than 15 seconds old, the driver is considered "stale" and excluded from matching queries. After 60 seconds without an update, the driver is marked offline. When the driver reconnects and sends a fresh update, the spatial index is updated and the driver becomes eligible for matching again. For trip tracking during connectivity loss, the client-side GPS trace (buffered locally) ensures that the fare calculation remains accurate even if some updates never reach the server in real time. The system must also handle out-of-order updates: a delayed batch from 30 seconds ago should not overwrite the current position in the spatial index. This is enforced by comparing timestamps before updating.

**Senior Tier**

**Q7: How would you design the surge pricing system to be responsive, accurate, and resistant to manipulation?**

Model Answer: The surge pricing system operates on a loop with a 60-second cycle. Every minute, for each geographic zone (H3 resolution 7, approximately 5 km^2), the system computes: (1) the supply count — number of available drivers with fresh location updates in the zone; (2) the demand rate — number of ride requests in the past 2 minutes, annualized to a per-minute rate; (3) the demand forecast — predicted demand for the next 5 minutes based on historical patterns, current trends, and external signals (events, weather). The surge multiplier is computed as a function of the ratio (demand_rate + forecasted_demand) / supply_count, calibrated against historical price-elasticity data (how much does a 1.5x surge reduce demand in this zone at this time of day?).

To prevent oscillation, the system applies exponential smoothing: new_surge = alpha * computed_surge + (1 - alpha) * previous_surge, with alpha around 0.3. This means surge changes gradually rather than flipping on and off. To prevent manipulation, the system detects anomalies: if more than 30% of drivers in a zone go offline simultaneously, it flags the event and computes surge based on the pre-anomaly supply count for the next 10 minutes. Anti-gaming also includes a minimum online duration requirement (a driver who goes offline and immediately returns during surge receives the pre-surge rate for their next trip). The system is implemented as a stateless computation service that reads from the location service (supply) and the request log (demand), computes multipliers, and publishes them to a Redis cache with a 90-second TTL. The pricing service reads the surge multiplier from Redis when computing fare estimates. Each zone's surge history is stored for regulatory compliance and dispute resolution.

**Q8: Design the system to support shared rides (pooling) where multiple riders share a vehicle.**

Model Answer: Shared rides introduce a fundamentally different matching problem. Instead of 1:1 rider-to-driver matching, the system must solve a dynamic vehicle routing problem: given a vehicle already carrying passenger A from origin_A to destination_A, can it efficiently pick up passenger B (origin_B to destination_B) with acceptable detour for both parties? The constraint is typically that neither passenger's trip time increases by more than 25-40% compared to a direct ride.

The system maintains a "trip plan" for each active shared-ride vehicle: an ordered sequence of waypoints (pickups and drop-offs). When a new shared-ride request arrives, the matching service evaluates all active shared-ride vehicles in the vicinity by: (1) inserting the new rider's pickup and drop-off into every possible position in the trip plan; (2) computing the total trip time for all passengers under each insertion; (3) filtering insertions that violate the detour constraint; (4) scoring remaining options by total vehicle-miles (to minimize platform cost) and maximum passenger detour (to maximize passenger satisfaction). The best match is offered to the rider with an updated ETA and fare estimate.

The fare for each passenger in a shared ride is computed based on the distance of a direct route (not the actual shared route), discounted by a pooling factor (e.g., 25-40% off). This ensures that passengers always pay less than a solo ride, even if the shared vehicle takes a longer actual route. The state machine for shared rides is more complex: a single vehicle may be simultaneously in ARRIVING (for passenger B) and IN_PROGRESS (for passenger A). The trip service must track each passenger's sub-trip independently while managing the overall vehicle's itinerary.

**Q9: How would you architect the ride-sharing system for global deployment across 70+ countries with regional regulations?**

Model Answer: The architecture follows a regional deployment model with a global control plane. The world is divided into 5-8 deployment regions (US-East, US-West, EU-West, EU-Central, APAC-Southeast, APAC-Northeast, LATAM, Middle-East-Africa). Each region runs a complete, self-contained stack: API gateway, matching service, location service, trip service, and payment service. A rider in Paris is served entirely by the EU-West deployment; their requests never leave the region. This provides low latency (sub-50ms to the nearest data center), data residency compliance (EU data stays in EU, satisfying GDPR), and fault isolation (a US-East outage does not affect European riders).

The global control plane handles cross-region concerns: user identity (a single account works worldwide), payment methods (credit cards registered in one country work in another), and trip history (a user can view their Paris trip history while in New York). This is implemented via a globally replicated user database (CockroachDB or DynamoDB Global Tables) with conflict resolution for concurrent updates. Regional regulations are encoded as configuration: in Germany, drivers must have commercial licenses (filter unqualified drivers from the pool); in London, the congestion charge is added to fares; in some Middle Eastern countries, female riders can request female drivers. These rules are stored in a regional configuration service and injected into the matching and pricing pipelines at runtime.

Deployment and rollout use a region-by-region strategy. New features are deployed to a low-traffic region first (e.g., Australia), monitored for 48 hours, then progressively rolled out to larger regions. Each region has its own Kafka cluster, its own database instances, and its own auto-scaling policies tuned to local traffic patterns (rush hour in Tokyo is midnight in New York). The monitoring system aggregates metrics globally but alerts regionally, so an on-call engineer in Europe handles EU incidents without needing to understand the US deployment.

---

### Section 11 — Complete Code Example

The following implementation demonstrates the four core components of a ride-sharing backend: geospatial indexing with geohash, driver location tracking, ride matching, and trip state machine management. We present pseudocode first for conceptual clarity, then a working Node.js implementation with detailed explanations.

**Pseudocode: Geospatial Indexing and Matching**

```
PSEUDOCODE: Ride-Sharing Core Services

--- Geohash Encoding ---
FUNCTION geohash_encode(latitude, longitude, precision):
    lat_range = [-90, 90]
    lng_range = [-180, 180]
    hash_string = ""
    bits = [16, 8, 4, 2, 1]       // 5 bits per base-32 character
    bit_index = 0
    current_char = 0
    is_longitude = TRUE             // alternate between lng and lat bits

    WHILE length(hash_string) < precision:
        IF is_longitude:
            mid = (lng_range[0] + lng_range[1]) / 2
            IF longitude >= mid:
                current_char = current_char OR bits[bit_index]
                lng_range[0] = mid
            ELSE:
                lng_range[1] = mid
        ELSE:
            mid = (lat_range[0] + lat_range[1]) / 2
            IF latitude >= mid:
                current_char = current_char OR bits[bit_index]
                lat_range[0] = mid
            ELSE:
                lat_range[1] = mid

        is_longitude = NOT is_longitude
        bit_index = bit_index + 1

        IF bit_index == 5:
            hash_string = hash_string + BASE32_CHARS[current_char]
            bit_index = 0
            current_char = 0

    RETURN hash_string

--- Spatial Index ---
CLASS SpatialIndex:
    grid = HashMap<String, Set<DriverID>>    // geohash -> driver IDs
    positions = HashMap<DriverID, Location>  // driver -> latest position

    FUNCTION update_driver(driver_id, latitude, longitude, timestamp):
        new_hash = geohash_encode(latitude, longitude, precision=6)
        old_location = positions.get(driver_id)

        IF old_location EXISTS:
            old_hash = geohash_encode(old_location.lat, old_location.lng, 6)
            IF old_hash != new_hash:
                grid[old_hash].remove(driver_id)
                grid[new_hash].add(driver_id)
        ELSE:
            grid[new_hash].add(driver_id)

        positions[driver_id] = {lat, lng, timestamp, status: AVAILABLE}

    FUNCTION find_nearby_drivers(latitude, longitude, radius_km):
        center_hash = geohash_encode(latitude, longitude, precision=6)
        neighbor_hashes = get_neighbors(center_hash)  // 8 surrounding cells
        search_cells = [center_hash] + neighbor_hashes

        candidates = []
        FOR EACH cell IN search_cells:
            FOR EACH driver_id IN grid[cell]:
                loc = positions[driver_id]
                IF loc.status == AVAILABLE:
                    dist = haversine(latitude, longitude, loc.lat, loc.lng)
                    IF dist <= radius_km:
                        candidates.append({driver_id, distance: dist})

        SORT candidates BY distance ASC
        RETURN candidates

--- Ride Matching ---
FUNCTION match_ride(request):
    candidates = spatial_index.find_nearby_drivers(
        request.pickup_lat, request.pickup_lng, radius_km=5
    )

    IF candidates IS EMPTY:
        RETURN {status: "no_drivers_available"}

    // Compute ETA for top candidates
    FOR EACH candidate IN candidates[0..min(10, len(candidates))]:
        candidate.eta = eta_service.compute(
            candidate.location, request.pickup_location
        )

    SORT candidates BY eta ASC
    best_driver = candidates[0]

    // Atomically claim the driver
    success = atomic_compare_and_swap(
        key=best_driver.driver_id,
        expected_status=AVAILABLE,
        new_status=MATCHED
    )

    IF success:
        RETURN {status: "matched", driver: best_driver}
    ELSE:
        // Driver was claimed by another request; retry with next
        RETURN match_ride(request)  // recursive retry

--- Trip State Machine ---
CLASS TripStateMachine:
    VALID_TRANSITIONS = {
        REQUESTED:   [MATCHED, CANCELLED],
        MATCHED:     [ACCEPTED, CANCELLED],
        ACCEPTED:    [ARRIVING, CANCELLED],
        ARRIVING:    [IN_PROGRESS, CANCELLED],
        IN_PROGRESS: [COMPLETED],
        COMPLETED:   [PAID],
        PAID:        [RATED]
    }

    FUNCTION transition(trip, new_state, metadata):
        IF new_state NOT IN VALID_TRANSITIONS[trip.current_state]:
            RAISE InvalidTransitionError

        old_state = trip.current_state
        trip.current_state = new_state
        trip.updated_at = NOW()
        trip.history.append({from: old_state, to: new_state, at: NOW()})

        // Side effects
        SWITCH new_state:
            CASE MATCHED:
                notify_driver(trip.driver_id, trip)
                start_acceptance_timer(trip, timeout=15s)
            CASE ACCEPTED:
                notify_rider(trip.rider_id, "driver_accepted", trip)
            CASE ARRIVING:
                notify_rider(trip.rider_id, "driver_arriving", trip)
                start_noshow_timer(trip, timeout=300s)
            CASE IN_PROGRESS:
                start_metering(trip)
            CASE COMPLETED:
                fare = calculate_fare(trip)
                process_payment(trip, fare)
            CASE CANCELLED:
                handle_cancellation(trip, old_state, metadata.reason)
                release_driver(trip.driver_id)

        persist(trip)
```

**Node.js Implementation**

```javascript
// ride-sharing-core.js
// Complete implementation of geospatial indexing, location tracking,
// ride matching, and trip state machine for a ride-sharing service.

// ============================================================
// PART 1: GEOHASH ENCODING
// ============================================================

// Base-32 character set used by the geohash standard.
// Each character encodes 5 bits of interleaved lat/lng precision.
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encodes a latitude/longitude pair into a geohash string.
 * The algorithm interleaves bits of longitude and latitude,
 * alternately bisecting each range, then encodes every 5 bits
 * as a base-32 character.
 *
 * @param {number} lat - Latitude in degrees (-90 to 90)
 * @param {number} lng - Longitude in degrees (-180 to 180)
 * @param {number} precision - Number of characters in the geohash (1-12)
 * @returns {string} The geohash string
 */
function geohashEncode(lat, lng, precision = 6) {
  // Initialize the full range of possible latitude and longitude values.
  // These ranges are bisected repeatedly to narrow down the location.
  let latRange = [-90.0, 90.0];
  let lngRange = [-180.0, 180.0];
  let hash = '';
  // bits array represents the 5-bit positions within a single base-32 char.
  // Each iteration sets one bit, and after 5 bits we emit a character.
  const bits = [16, 8, 4, 2, 1];
  let bitIndex = 0;
  let charValue = 0;
  // Geohash interleaves longitude bits (even positions) and latitude bits
  // (odd positions). We start with longitude.
  let isLng = true;

  // Continue until we have generated the requested number of characters.
  while (hash.length < precision) {
    if (isLng) {
      // Bisect the longitude range.
      const mid = (lngRange[0] + lngRange[1]) / 2;
      if (lng >= mid) {
        // Point is in the eastern half; set this bit to 1.
        charValue |= bits[bitIndex];
        lngRange[0] = mid;
      } else {
        // Point is in the western half; bit remains 0.
        lngRange[1] = mid;
      }
    } else {
      // Bisect the latitude range.
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        // Point is in the northern half; set this bit to 1.
        charValue |= bits[bitIndex];
        latRange[0] = mid;
      } else {
        // Point is in the southern half; bit remains 0.
        latRange[1] = mid;
      }
    }

    // Alternate between longitude and latitude on each bit.
    isLng = !isLng;
    bitIndex++;

    // After accumulating 5 bits, convert to a base-32 character.
    if (bitIndex === 5) {
      hash += BASE32[charValue];
      bitIndex = 0;
      charValue = 0;
    }
  }

  return hash;
}

/**
 * Returns the 8 neighboring geohash cells for a given geohash.
 * This is necessary because a point near the edge of a cell might
 * have its nearest neighbor in an adjacent cell.
 *
 * Simplified implementation: decodes the geohash to its center point,
 * then computes geohashes at 8 offset positions (N, NE, E, SE, S, SW, W, NW).
 */
function getNeighbors(hash) {
  // Decode the geohash to get its center lat/lng and the cell dimensions.
  const { lat, lng, latErr, lngErr } = geohashDecode(hash);
  // The cell's half-dimensions tell us how far to offset for neighbors.
  const dlat = latErr * 2;
  const dlng = lngErr * 2;

  // Compute geohashes for all 8 surrounding cells by offsetting
  // the center point by one cell width/height in each direction.
  const offsets = [
    [dlat, 0], [dlat, dlng], [0, dlng], [-dlat, dlng],
    [-dlat, 0], [-dlat, -dlng], [0, -dlng], [dlat, -dlng]
  ];

  return offsets.map(([oLat, oLng]) =>
    geohashEncode(lat + oLat, lng + oLng, hash.length)
  );
}

/**
 * Decodes a geohash string back to its center latitude/longitude
 * and the error margins (half the cell dimensions).
 */
function geohashDecode(hash) {
  let latRange = [-90.0, 90.0];
  let lngRange = [-180.0, 180.0];
  let isLng = true;

  // Reverse the encoding process: for each character, extract 5 bits
  // and use each bit to bisect the appropriate range.
  for (const char of hash) {
    const charValue = BASE32.indexOf(char);
    for (const bit of [16, 8, 4, 2, 1]) {
      if (isLng) {
        const mid = (lngRange[0] + lngRange[1]) / 2;
        if (charValue & bit) {
          lngRange[0] = mid;
        } else {
          lngRange[1] = mid;
        }
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (charValue & bit) {
          latRange[0] = mid;
        } else {
          latRange[1] = mid;
        }
      }
      isLng = !isLng;
    }
  }

  // The center of the final range is our decoded point.
  // The error is half the remaining range.
  return {
    lat: (latRange[0] + latRange[1]) / 2,
    lng: (lngRange[0] + lngRange[1]) / 2,
    latErr: (latRange[1] - latRange[0]) / 2,
    lngErr: (lngRange[1] - lngRange[0]) / 2
  };
}

// ============================================================
// PART 2: HAVERSINE DISTANCE CALCULATION
// ============================================================

/**
 * Computes the great-circle distance between two points on Earth
 * using the Haversine formula. Returns distance in kilometers.
 *
 * This is used to compute straight-line distance between a rider
 * and candidate drivers. Road-network ETA would replace this in
 * production, but Haversine serves as a fast pre-filter.
 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in kilometers
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  // The Haversine formula calculates the angular distance between
  // two points on a sphere, accounting for the curvature of the Earth.
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================
// PART 3: SPATIAL INDEX (DRIVER LOCATION TRACKING)
// ============================================================

// Driver status constants. A driver cycles through these states
// as they go online, get matched, complete trips, etc.
const DriverStatus = {
  AVAILABLE: 'available',     // Online and eligible for matching
  MATCHED: 'matched',         // Assigned to a ride, awaiting acceptance
  ON_TRIP: 'on_trip',         // Currently transporting a rider
  OFFLINE: 'offline'          // Not accepting rides
};

/**
 * SpatialIndex maintains an in-memory geohash grid of all active drivers.
 * It supports two core operations:
 *   1. updateDriver() - O(1) update when a driver reports a new location
 *   2. findNearby() - O(k) lookup where k is the number of drivers in
 *      the 9-cell neighborhood (center + 8 neighbors)
 */
class SpatialIndex {
  constructor(precision = 6) {
    // The geohash precision determines cell size. Precision 6 gives
    // cells of roughly 1.2km x 0.6km, suitable for urban ride matching.
    this.precision = precision;
    // grid: Map from geohash string to Set of driver IDs in that cell.
    // This is the primary lookup structure for spatial queries.
    this.grid = new Map();
    // drivers: Map from driver ID to their current state (location,
    // status, timestamp). This enables O(1) lookup of any driver's info.
    this.drivers = new Map();
    // Staleness threshold: if a driver's last update is older than this,
    // they are excluded from matching (likely disconnected).
    this.staleThresholdMs = 15000; // 15 seconds
  }

  /**
   * Updates a driver's location in the spatial index.
   * Called every 3-5 seconds per active driver.
   * Handles cell migration (moving from one geohash cell to another).
   */
  updateDriver(driverId, lat, lng, timestamp = Date.now()) {
    const newHash = geohashEncode(lat, lng, this.precision);
    const existing = this.drivers.get(driverId);

    if (existing) {
      const oldHash = existing.geohash;
      // If the driver has moved to a different geohash cell,
      // remove them from the old cell and add to the new one.
      if (oldHash !== newHash) {
        this._removeFromGrid(oldHash, driverId);
        this._addToGrid(newHash, driverId);
      }
      // Update the driver's stored location and timestamp.
      existing.lat = lat;
      existing.lng = lng;
      existing.geohash = newHash;
      existing.lastUpdate = timestamp;
    } else {
      // New driver coming online: add to grid and driver map.
      this._addToGrid(newHash, driverId);
      this.drivers.set(driverId, {
        lat, lng,
        geohash: newHash,
        status: DriverStatus.AVAILABLE,
        lastUpdate: timestamp
      });
    }
  }

  /**
   * Finds all available, non-stale drivers within a radius of a point.
   * Uses the 9-cell geohash neighborhood as a coarse filter, then
   * applies Haversine distance as a fine filter.
   *
   * @returns Array of {driverId, distance, lat, lng} sorted by distance
   */
  findNearby(lat, lng, radiusKm = 5) {
    const centerHash = geohashEncode(lat, lng, this.precision);
    const neighbors = getNeighbors(centerHash);
    // Search the center cell plus all 8 neighbors to avoid
    // missing drivers near cell boundaries.
    const searchCells = [centerHash, ...neighbors];
    const now = Date.now();
    const candidates = [];

    for (const cell of searchCells) {
      const driversInCell = this.grid.get(cell);
      if (!driversInCell) continue;

      for (const driverId of driversInCell) {
        const driver = this.drivers.get(driverId);
        // Skip drivers that are not available (already matched or on trip).
        if (driver.status !== DriverStatus.AVAILABLE) continue;
        // Skip stale drivers (no update in 15+ seconds, likely offline).
        if (now - driver.lastUpdate > this.staleThresholdMs) continue;

        const distance = haversine(lat, lng, driver.lat, driver.lng);
        // Apply the radius filter to exclude drivers outside the search area.
        if (distance <= radiusKm) {
          candidates.push({ driverId, distance, lat: driver.lat, lng: driver.lng });
        }
      }
    }

    // Sort by distance so the matching algorithm can prioritize closer drivers.
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates;
  }

  /**
   * Atomically updates a driver's status.
   * Uses compare-and-swap semantics to prevent race conditions
   * when two ride requests compete for the same driver.
   *
   * @returns true if the status was successfully changed, false otherwise
   */
  compareAndSwapStatus(driverId, expectedStatus, newStatus) {
    const driver = this.drivers.get(driverId);
    if (!driver) return false;
    // Atomic check: only update if current status matches expected.
    // In production, this would use a distributed lock or DB transaction.
    if (driver.status !== expectedStatus) return false;
    driver.status = newStatus;
    return true;
  }

  /**
   * Removes a driver from the spatial index entirely (going offline).
   */
  removeDriver(driverId) {
    const driver = this.drivers.get(driverId);
    if (driver) {
      this._removeFromGrid(driver.geohash, driverId);
      this.drivers.delete(driverId);
    }
  }

  // --- Private helper methods ---

  _addToGrid(hash, driverId) {
    if (!this.grid.has(hash)) {
      this.grid.set(hash, new Set());
    }
    this.grid.get(hash).add(driverId);
  }

  _removeFromGrid(hash, driverId) {
    const cell = this.grid.get(hash);
    if (cell) {
      cell.delete(driverId);
      // Clean up empty cells to prevent memory leaks over time.
      if (cell.size === 0) this.grid.delete(hash);
    }
  }

  /**
   * Returns statistics about the current state of the index.
   * Useful for monitoring and debugging.
   */
  getStats() {
    let availableCount = 0;
    for (const [, driver] of this.drivers) {
      if (driver.status === DriverStatus.AVAILABLE) availableCount++;
    }
    return {
      totalDrivers: this.drivers.size,
      availableDrivers: availableCount,
      activeCells: this.grid.size
    };
  }
}

// ============================================================
// PART 4: RIDE MATCHING SERVICE
// ============================================================

/**
 * RideMatchingService handles the assignment of ride requests to drivers.
 * It queries the spatial index for nearby candidates, scores them,
 * and attempts to claim the best driver atomically.
 */
class RideMatchingService {
  /**
   * @param {SpatialIndex} spatialIndex - The shared spatial index
   * @param {object} options - Configuration for matching behavior
   */
  constructor(spatialIndex, options = {}) {
    this.spatialIndex = spatialIndex;
    // Maximum number of drivers to evaluate per request.
    // More candidates = better match quality but higher latency.
    this.maxCandidates = options.maxCandidates || 10;
    // Maximum number of dispatch attempts before giving up.
    this.maxRetries = options.maxRetries || 5;
    // Initial search radius in km. Expands if no drivers are found.
    this.initialRadiusKm = options.initialRadiusKm || 5;
    // Maximum search radius to prevent offering drivers 30+ km away.
    this.maxRadiusKm = options.maxRadiusKm || 15;
    // Simulated driver acceptance rate (for demonstration).
    this.acceptanceRate = options.acceptanceRate || 0.7;
  }

  /**
   * Attempts to match a ride request with an available driver.
   * Implements a retry loop with radius expansion.
   *
   * @param {object} request - {riderId, pickupLat, pickupLng, destLat, destLng}
   * @returns {object} Match result with driver info or failure reason
   */
  async matchRide(request) {
    let radius = this.initialRadiusKm;
    let attempt = 0;

    while (attempt < this.maxRetries) {
      attempt++;
      console.log(`  Attempt ${attempt}: searching within ${radius}km...`);

      // Step 1: Find nearby available drivers using the spatial index.
      const candidates = this.spatialIndex.findNearby(
        request.pickupLat, request.pickupLng, radius
      );

      if (candidates.length === 0) {
        console.log(`  No drivers found within ${radius}km`);
        // Expand search radius for the next attempt.
        radius = Math.min(radius * 1.5, this.maxRadiusKm);
        continue;
      }

      // Step 2: Score top candidates. In production, this calls the
      // ETA service for road-network travel time. Here we use distance
      // as a proxy and add a simulated ETA.
      const scoredCandidates = candidates
        .slice(0, this.maxCandidates)
        .map((c) => ({
          ...c,
          // Simulate ETA: ~2 minutes per km in urban traffic
          estimatedEtaMinutes: Math.round(c.distance * 2 * 10) / 10
        }))
        .sort((a, b) => a.estimatedEtaMinutes - b.estimatedEtaMinutes);

      // Step 3: Attempt to claim the best driver atomically.
      for (const candidate of scoredCandidates) {
        // Compare-and-swap ensures only one request claims this driver.
        const claimed = this.spatialIndex.compareAndSwapStatus(
          candidate.driverId,
          DriverStatus.AVAILABLE,
          DriverStatus.MATCHED
        );

        if (!claimed) {
          // Another request claimed this driver between our search
          // and our claim attempt. Try the next candidate.
          console.log(`  Driver ${candidate.driverId} already claimed, trying next`);
          continue;
        }

        // Step 4: Simulate driver acceptance decision.
        // In production, this would send a push notification and await
        // a response with a 15-second timeout.
        const accepted = Math.random() < this.acceptanceRate;

        if (accepted) {
          console.log(`  Driver ${candidate.driverId} accepted! ETA: ${candidate.estimatedEtaMinutes} min`);
          return {
            status: 'matched',
            driverId: candidate.driverId,
            etaMinutes: candidate.estimatedEtaMinutes,
            distanceKm: Math.round(candidate.distance * 100) / 100
          };
        } else {
          // Driver declined. Release them back to available status
          // so they can be matched with other requests.
          console.log(`  Driver ${candidate.driverId} declined, trying next`);
          this.spatialIndex.compareAndSwapStatus(
            candidate.driverId,
            DriverStatus.MATCHED,
            DriverStatus.AVAILABLE
          );
        }
      }

      // All candidates in this radius were tried. Expand and retry.
      radius = Math.min(radius * 1.5, this.maxRadiusKm);
    }

    // All retries exhausted. No driver could be matched.
    return { status: 'no_drivers_available' };
  }
}

// ============================================================
// PART 5: TRIP STATE MACHINE
// ============================================================

// All possible trip states, forming a directed acyclic graph
// (with CANCELLED as a terminal state reachable from most states).
const TripState = {
  REQUESTED: 'requested',
  MATCHED: 'matched',
  ACCEPTED: 'accepted',
  ARRIVING: 'arriving',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  PAID: 'paid',
  RATED: 'rated',
  CANCELLED: 'cancelled'
};

// Defines which state transitions are legal. Any transition not
// listed here will be rejected, preventing invalid state changes.
const VALID_TRANSITIONS = {
  [TripState.REQUESTED]:   [TripState.MATCHED, TripState.CANCELLED],
  [TripState.MATCHED]:     [TripState.ACCEPTED, TripState.CANCELLED],
  [TripState.ACCEPTED]:    [TripState.ARRIVING, TripState.CANCELLED],
  [TripState.ARRIVING]:    [TripState.IN_PROGRESS, TripState.CANCELLED],
  [TripState.IN_PROGRESS]: [TripState.COMPLETED],
  [TripState.COMPLETED]:   [TripState.PAID],
  [TripState.PAID]:        [TripState.RATED],
  [TripState.CANCELLED]:   [],  // Terminal state, no further transitions
  [TripState.RATED]:       []   // Terminal state
};

/**
 * TripStateMachine manages the lifecycle of a single ride.
 * It enforces valid transitions, records history, and triggers
 * side effects (notifications, payments, etc.) at each transition.
 */
class TripStateMachine {
  /**
   * Creates a new trip in the REQUESTED state.
   * @param {object} tripData - Initial trip information
   */
  constructor(tripData) {
    this.tripId = tripData.tripId;
    this.riderId = tripData.riderId;
    this.driverId = null;
    this.pickupLat = tripData.pickupLat;
    this.pickupLng = tripData.pickupLng;
    this.destLat = tripData.destLat;
    this.destLng = tripData.destLng;
    this.state = TripState.REQUESTED;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    // History log: records every state transition for debugging,
    // dispute resolution, and analytics.
    this.history = [
      { from: null, to: TripState.REQUESTED, at: this.createdAt }
    ];
    // Route trace: GPS coordinates recorded during the trip.
    this.routeTrace = [];
    this.fareDetails = null;
  }

  /**
   * Attempts to transition the trip to a new state.
   * Validates the transition, records it, and executes side effects.
   *
   * @param {string} newState - The target state
   * @param {object} metadata - Additional data for the transition
   * @returns {object} Result of the transition attempt
   */
  transition(newState, metadata = {}) {
    // Validate: check that the transition is allowed from the current state.
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed || !allowed.includes(newState)) {
      return {
        success: false,
        error: `Invalid transition: ${this.state} -> ${newState}. ` +
               `Allowed transitions: [${allowed.join(', ')}]`
      };
    }

    const previousState = this.state;
    this.state = newState;
    this.updatedAt = Date.now();
    // Append to history for full audit trail.
    this.history.push({
      from: previousState,
      to: newState,
      at: this.updatedAt,
      metadata
    });

    // Execute side effects based on the new state.
    // In production, these would be async calls to external services.
    const sideEffects = this._executeSideEffects(newState, previousState, metadata);

    return {
      success: true,
      previousState,
      currentState: newState,
      sideEffects
    };
  }

  /**
   * Records a GPS point along the trip route.
   * Only valid during the IN_PROGRESS state.
   */
  addRoutePoint(lat, lng, timestamp = Date.now()) {
    if (this.state !== TripState.IN_PROGRESS) {
      return { success: false, error: 'Route points only accepted during IN_PROGRESS' };
    }
    this.routeTrace.push({ lat, lng, timestamp });
    return { success: true, pointCount: this.routeTrace.length };
  }

  /**
   * Calculates the fare based on the recorded route trace.
   * Uses distance (sum of segments) and time (first to last point).
   */
  calculateFare(surgeMultiplier = 1.0) {
    if (this.routeTrace.length < 2) {
      return { error: 'Insufficient route data for fare calculation' };
    }

    // Pricing constants (typical for a mid-tier US market)
    const BASE_FARE = 2.50;         // Fixed base charge
    const PER_KM_RATE = 1.10;       // Per kilometer charge
    const PER_MINUTE_RATE = 0.20;   // Per minute charge
    const BOOKING_FEE = 2.00;       // Platform fee
    const MINIMUM_FARE = 7.00;      // Floor price

    // Calculate total distance by summing Haversine distances
    // between consecutive GPS points in the route trace.
    let totalDistanceKm = 0;
    for (let i = 1; i < this.routeTrace.length; i++) {
      const prev = this.routeTrace[i - 1];
      const curr = this.routeTrace[i];
      totalDistanceKm += haversine(prev.lat, prev.lng, curr.lat, curr.lng);
    }

    // Calculate trip duration from first to last route point.
    const firstPoint = this.routeTrace[0];
    const lastPoint = this.routeTrace[this.routeTrace.length - 1];
    const durationMinutes = (lastPoint.timestamp - firstPoint.timestamp) / 60000;

    // Apply the fare formula with surge multiplier.
    // Surge applies to the distance and time components, not the booking fee.
    const distanceCharge = PER_KM_RATE * totalDistanceKm;
    const timeCharge = PER_MINUTE_RATE * durationMinutes;
    const surgedAmount = surgeMultiplier * (BASE_FARE + distanceCharge + timeCharge);
    const totalFare = Math.max(BOOKING_FEE + surgedAmount, MINIMUM_FARE);

    this.fareDetails = {
      baseFare: BASE_FARE,
      distanceKm: Math.round(totalDistanceKm * 100) / 100,
      distanceCharge: Math.round(distanceCharge * 100) / 100,
      durationMinutes: Math.round(durationMinutes * 10) / 10,
      timeCharge: Math.round(timeCharge * 100) / 100,
      surgeMultiplier,
      bookingFee: BOOKING_FEE,
      totalFare: Math.round(totalFare * 100) / 100
    };

    return this.fareDetails;
  }

  /**
   * Executes side effects for each state transition.
   * Returns a description of what actions were taken.
   */
  _executeSideEffects(newState, previousState, metadata) {
    const effects = [];

    switch (newState) {
      case TripState.MATCHED:
        this.driverId = metadata.driverId;
        effects.push(`Assigned driver ${metadata.driverId}`);
        effects.push('Sent ride offer notification to driver');
        effects.push('Started 15-second acceptance timer');
        break;

      case TripState.ACCEPTED:
        effects.push(`Notified rider: driver is on the way`);
        effects.push('Started real-time location sharing');
        break;

      case TripState.ARRIVING:
        effects.push('Notified rider: driver is arriving');
        effects.push('Started 5-minute no-show timer');
        break;

      case TripState.IN_PROGRESS:
        effects.push('Started trip metering (high-frequency GPS)');
        effects.push('Enabled trip sharing link for rider');
        break;

      case TripState.COMPLETED:
        effects.push('Stopped trip metering');
        effects.push(`Recorded ${this.routeTrace.length} route points`);
        break;

      case TripState.PAID:
        effects.push(`Charged rider: $${metadata.amount}`);
        effects.push('Queued driver payout');
        break;

      case TripState.RATED:
        effects.push(`Rider rated driver: ${metadata.riderRating}/5`);
        effects.push(`Driver rated rider: ${metadata.driverRating}/5`);
        break;

      case TripState.CANCELLED:
        effects.push(`Trip cancelled in state: ${previousState}`);
        effects.push(`Reason: ${metadata.reason || 'not specified'}`);
        // Cancellation fees apply only after the driver has accepted.
        if ([TripState.ACCEPTED, TripState.ARRIVING].includes(previousState)) {
          effects.push('Cancellation fee of $5.00 applied to rider');
        }
        if (this.driverId) {
          effects.push(`Released driver ${this.driverId} back to available pool`);
        }
        break;
    }

    return effects;
  }

  /**
   * Returns a summary of the trip's current state and history.
   */
  getSummary() {
    return {
      tripId: this.tripId,
      riderId: this.riderId,
      driverId: this.driverId,
      state: this.state,
      pickup: { lat: this.pickupLat, lng: this.pickupLng },
      destination: { lat: this.destLat, lng: this.destLng },
      routePoints: this.routeTrace.length,
      fareDetails: this.fareDetails,
      transitionCount: this.history.length,
      history: this.history
    };
  }
}

// ============================================================
// PART 6: DEMONSTRATION — FULL RIDE LIFECYCLE
// ============================================================

/**
 * Simulates a complete ride lifecycle: populating the spatial index
 * with drivers, matching a ride request, and walking the trip through
 * every state in the state machine.
 */
async function simulateFullRideLifecycle() {
  console.log('=== RIDE-SHARING SERVICE SIMULATION ===\n');

  // --- Step 1: Initialize the spatial index and register drivers ---
  console.log('--- Step 1: Initializing Spatial Index ---');
  const spatialIndex = new SpatialIndex(6);

  // Simulate 20 drivers scattered around downtown San Francisco.
  // In production, these updates arrive via the Kafka location pipeline.
  const sfDrivers = [
    { id: 'driver_001', lat: 37.7749, lng: -122.4194 }, // Market St
    { id: 'driver_002', lat: 37.7751, lng: -122.4180 },
    { id: 'driver_003', lat: 37.7760, lng: -122.4210 },
    { id: 'driver_004', lat: 37.7740, lng: -122.4170 },
    { id: 'driver_005', lat: 37.7770, lng: -122.4230 },
    { id: 'driver_006', lat: 37.7730, lng: -122.4150 },
    { id: 'driver_007', lat: 37.7780, lng: -122.4200 },
    { id: 'driver_008', lat: 37.7720, lng: -122.4180 },
    { id: 'driver_009', lat: 37.7790, lng: -122.4250 },
    { id: 'driver_010', lat: 37.7710, lng: -122.4160 },
    { id: 'driver_011', lat: 37.7800, lng: -122.4100 }, // Farther east
    { id: 'driver_012', lat: 37.7700, lng: -122.4300 }, // Farther west
    { id: 'driver_013', lat: 37.7850, lng: -122.4090 },
    { id: 'driver_014', lat: 37.7650, lng: -122.4350 },
    { id: 'driver_015', lat: 37.7755, lng: -122.4190 },
    { id: 'driver_016', lat: 37.7745, lng: -122.4175 },
    { id: 'driver_017', lat: 37.7735, lng: -122.4205 },
    { id: 'driver_018', lat: 37.7765, lng: -122.4185 },
    { id: 'driver_019', lat: 37.7725, lng: -122.4195 },
    { id: 'driver_020', lat: 37.7775, lng: -122.4215 }
  ];

  for (const driver of sfDrivers) {
    spatialIndex.updateDriver(driver.id, driver.lat, driver.lng);
  }

  const stats = spatialIndex.getStats();
  console.log(`Registered ${stats.totalDrivers} drivers across ${stats.activeCells} geohash cells`);
  console.log(`Available for matching: ${stats.availableDrivers}\n`);

  // --- Step 2: Rider requests a ride ---
  console.log('--- Step 2: Rider Requests a Ride ---');
  const rideRequest = {
    riderId: 'rider_42',
    pickupLat: 37.7748,
    pickupLng: -122.4192,
    destLat: 37.7849,      // ~1.1 km north
    destLng: -122.4094
  };
  console.log(`Rider ${rideRequest.riderId} requesting pickup at (${rideRequest.pickupLat}, ${rideRequest.pickupLng})`);
  console.log(`Destination: (${rideRequest.destLat}, ${rideRequest.destLng})\n`);

  // --- Step 3: Find and display nearby drivers ---
  console.log('--- Step 3: Finding Nearby Drivers ---');
  const nearbyDrivers = spatialIndex.findNearby(
    rideRequest.pickupLat, rideRequest.pickupLng, 3
  );
  console.log(`Found ${nearbyDrivers.length} available drivers within 3km:`);
  for (const d of nearbyDrivers.slice(0, 5)) {
    console.log(`  ${d.driverId}: ${(d.distance * 1000).toFixed(0)}m away`);
  }
  console.log();

  // --- Step 4: Match the ride ---
  console.log('--- Step 4: Matching Ride ---');
  const matcher = new RideMatchingService(spatialIndex, {
    maxCandidates: 5,
    maxRetries: 3,
    acceptanceRate: 0.8
  });
  const matchResult = await matcher.matchRide(rideRequest);
  console.log(`Match result: ${JSON.stringify(matchResult)}\n`);

  if (matchResult.status !== 'matched') {
    console.log('Could not match ride. Simulation ends.');
    return;
  }

  // --- Step 5: Walk through the full trip state machine ---
  console.log('--- Step 5: Trip State Machine Lifecycle ---');
  const trip = new TripStateMachine({
    tripId: 'trip_' + Date.now(),
    riderId: rideRequest.riderId,
    pickupLat: rideRequest.pickupLat,
    pickupLng: rideRequest.pickupLng,
    destLat: rideRequest.destLat,
    destLng: rideRequest.destLng
  });
  console.log(`Created trip ${trip.tripId} in state: ${trip.state}`);

  // Transition: REQUESTED -> MATCHED
  let result = trip.transition(TripState.MATCHED, {
    driverId: matchResult.driverId
  });
  console.log(`\n[${result.previousState} -> ${result.currentState}]`);
  result.sideEffects.forEach((e) => console.log(`  Effect: ${e}`));

  // Transition: MATCHED -> ACCEPTED
  result = trip.transition(TripState.ACCEPTED);
  console.log(`\n[${result.previousState} -> ${result.currentState}]`);
  result.sideEffects.forEach((e) => console.log(`  Effect: ${e}`));

  // Transition: ACCEPTED -> ARRIVING
  result = trip.transition(TripState.ARRIVING);
  console.log(`\n[${result.previousState} -> ${result.currentState}]`);
  result.sideEffects.forEach((e) => console.log(`  Effect: ${e}`));

  // Transition: ARRIVING -> IN_PROGRESS
  result = trip.transition(TripState.IN_PROGRESS);
  console.log(`\n[${result.previousState} -> ${result.currentState}]`);
  result.sideEffects.forEach((e) => console.log(`  Effect: ${e}`));

  // Simulate route points during the trip (driver moving from pickup to dest).
  // In production, these come from the GPS location pipeline at 1-2 sec intervals.
  console.log('\n  Recording route points...');
  const routePoints = [
    { lat: 37.7748, lng: -122.4192, t: 0 },       // Pickup
    { lat: 37.7758, lng: -122.4185, t: 30000 },    // 30s
    { lat: 37.7770, lng: -122.4170, t: 60000 },    // 1m
    { lat: 37.7785, lng: -122.4155, t: 90000 },    // 1.5m
    { lat: 37.7800, lng: -122.4140, t: 120000 },   // 2m
    { lat: 37.7815, lng: -122.4125, t: 150000 },   // 2.5m
    { lat: 37.7830, lng: -122.4110, t: 180000 },   // 3m
    { lat: 37.7849, lng: -122.4094, t: 210000 }    // 3.5m - Destination
  ];
  const baseTime = Date.now();
  for (const point of routePoints) {
    trip.addRoutePoint(point.lat, point.lng, baseTime + point.t);
  }
  console.log(`  Recorded ${routePoints.length} GPS points over 3.5 minutes`);

  // Transition: IN_PROGRESS -> COMPLETED
  result = trip.transition(TripState.COMPLETED);
  console.log(`\n[${result.previousState} -> ${result.currentState}]`);
  result.sideEffects.forEach((e) => console.log(`  Effect: ${e}`));

  // Calculate fare
  console.log('\n--- Fare Calculation ---');
  const fare = trip.calculateFare(1.0); // No surge
  console.log(`  Distance: ${fare.distanceKm} km`);
  console.log(`  Duration: ${fare.durationMinutes} min`);
  console.log(`  Base fare: $${fare.baseFare}`);
  console.log(`  Distance charge: $${fare.distanceCharge}`);
  console.log(`  Time charge: $${fare.timeCharge}`);
  console.log(`  Booking fee: $${fare.bookingFee}`);
  console.log(`  Surge: ${fare.surgeMultiplier}x`);
  console.log(`  TOTAL: $${fare.totalFare}`);

  // Transition: COMPLETED -> PAID
  result = trip.transition(TripState.PAID, { amount: fare.totalFare });
  console.log(`\n[${result.previousState} -> ${result.currentState}]`);
  result.sideEffects.forEach((e) => console.log(`  Effect: ${e}`));

  // Transition: PAID -> RATED
  result = trip.transition(TripState.RATED, {
    riderRating: 5,
    driverRating: 4
  });
  console.log(`\n[${result.previousState} -> ${result.currentState}]`);
  result.sideEffects.forEach((e) => console.log(`  Effect: ${e}`));

  // --- Step 6: Demonstrate invalid transition ---
  console.log('\n--- Step 6: Invalid Transition Test ---');
  const invalidResult = trip.transition(TripState.IN_PROGRESS);
  console.log(`Attempted RATED -> IN_PROGRESS: ${invalidResult.error}`);

  // --- Step 7: Demonstrate cancellation ---
  console.log('\n--- Step 7: Cancellation Scenario ---');
  const cancelTrip = new TripStateMachine({
    tripId: 'trip_cancel_demo',
    riderId: 'rider_99',
    pickupLat: 37.78,
    pickupLng: -122.42,
    destLat: 37.79,
    destLng: -122.41
  });
  cancelTrip.transition(TripState.MATCHED, { driverId: 'driver_050' });
  cancelTrip.transition(TripState.ACCEPTED);
  const cancelResult = cancelTrip.transition(TripState.CANCELLED, {
    reason: 'Rider changed plans'
  });
  console.log(`Cancellation from ACCEPTED state:`);
  cancelResult.sideEffects.forEach((e) => console.log(`  Effect: ${e}`));

  // --- Final Summary ---
  console.log('\n--- Trip Summary ---');
  const summary = trip.getSummary();
  console.log(`Trip: ${summary.tripId}`);
  console.log(`State: ${summary.state}`);
  console.log(`Rider: ${summary.riderId}, Driver: ${summary.driverId}`);
  console.log(`Route points: ${summary.routePoints}`);
  console.log(`Total fare: $${summary.fareDetails.totalFare}`);
  console.log(`Transitions: ${summary.transitionCount}`);

  console.log('\n=== SIMULATION COMPLETE ===');
}

// Run the simulation
simulateFullRideLifecycle().catch(console.error);
```

**Line-by-Line Explanation of Key Sections**

The `geohashEncode` function is the foundation of the spatial indexing system. It works by repeatedly bisecting the world. Starting with the full latitude range [-90, 90] and longitude range [-180, 180], it alternately splits the longitude and latitude in half. At each split, it sets a bit to 1 if the point falls in the upper half, 0 if in the lower half. After accumulating 5 bits, it maps the resulting value (0-31) to a base-32 character. The prefix property emerges naturally: two points that share the first 4 characters of their geohash are guaranteed to be within the same relatively small geographic region.

The `SpatialIndex` class maintains two data structures in tandem. The `grid` map provides cell-to-driver lookup (for spatial queries), while the `drivers` map provides driver-to-location lookup (for status updates and stale-driver pruning). When `updateDriver` is called, it computes the new geohash and checks whether the driver has moved to a different cell. Cell migration (removing from the old cell, adding to the new one) only happens when the geohash actually changes, which is an important optimization: a driver moving within a single 1.2 km cell triggers no grid update.

The `compareAndSwapStatus` method is critical for correctness in concurrent matching. When two ride requests simultaneously identify the same driver as the best candidate, only one should succeed. The compare-and-swap pattern ensures atomicity: the status is only updated if it currently matches the expected value. In a distributed production system, this would be implemented with a Redis `WATCH`/`MULTI`/`EXEC` transaction or a DynamoDB conditional write.

The `TripStateMachine` class encodes the business rules of a ride's lifecycle. The `VALID_TRANSITIONS` constant is the single source of truth for what state changes are legal. The `transition` method validates against this table before making any changes, preventing bugs like a trip jumping from REQUESTED directly to COMPLETED (skipping matching and pickup). The `_executeSideEffects` method demonstrates the event-driven nature of the system: each state transition triggers downstream actions (notifications, timers, payments) that would be asynchronous service calls in production.

---

### Section 12 — Connection to Next Topic

Every ride-sharing trip, no matter how sophisticated the geospatial indexing, matching algorithms, and real-time tracking, concludes with a single critical operation: the rider must be charged and the driver must be paid. The payment service that handles this transaction is far from trivial. It must process millions of payments per day across dozens of currencies and payment methods (credit cards, debit cards, digital wallets, cash in some markets, corporate accounts). It must be idempotent (a network retry must not double-charge the rider). It must handle complex splitting (shared rides, promotional credits, tips). It must comply with PCI-DSS security standards for credit card data. And it must reconcile with drivers' earnings on a weekly payout cycle, accounting for platform commissions, bonuses, and tax withholdings.

The ride-sharing design we explored in this topic focused on the real-time coordination problem: finding drivers, matching them to riders, and tracking trips as they happen. Topic 53, Design a Payment System, shifts focus to the financial transaction layer that underpins not just ride-sharing but every marketplace, e-commerce platform, and fintech application. Where this topic dealt with geospatial data structures and sub-second location updates, the payment system will deal with distributed transactions, eventual consistency in financial ledgers, idempotency keys, and the challenges of processing money at scale without losing a single cent. The fare calculation you saw in this topic's code example is the handoff point: it produces a dollar amount that the payment system must reliably charge, record, and eventually pay out. Understanding both sides of this boundary — the real-time coordination and the financial settlement — is what separates a senior engineer from someone who can only design half the system.

---

---

<!--
Topic: 53
Title: Design a Payment System (Stripe/PayPal)
Section: 11 — Real-World Designs Part 3
Track: 0-to-100 Deep Mastery
Difficulty: Senior
Interview Weight: High
Prerequisites: Topics 1-3, 6, 9, 23, 25, 32, 35-36
Next Topic: Topic 54 — Design a Ticket Booking System
Estimated Reading Time: 55-65 minutes
-->

## Topic 53: Design a Payment System (Stripe/PayPal)

### Section 1 — Why This Design?

Money is the lifeblood of commerce, and the systems that move it are among the most unforgiving pieces of software ever built. A bug in a social media feed shows you the wrong post; a bug in a payment system charges someone twice, loses funds, or creates money out of thin air. There is no "eventually correct" when real dollars are on the line. This is precisely why payment system design is one of the most feared and respected questions in system design interviews — it tests your understanding of transactional integrity, distributed consistency, idempotency, and real-world regulatory constraints simultaneously.

The story of digital payments begins in the late 1990s with a company called Confinity, founded by Peter Thiel and Max Levchin in 1998. Their original product involved cryptographic payments on Palm Pilots — a niche idea that quickly proved too narrow. Around the same time, Elon Musk founded X.com, an online banking startup. The two companies merged in 2000, eventually rebranding as PayPal, and the resulting platform became the dominant way to pay on eBay. PayPal's early engineering challenges were legendary: fraud rates threatened to destroy the company (at one point, losses from fraud exceeded revenue), and the team had to build some of the first real-time fraud detection systems in history. PayPal went public in 2002 and was acquired by eBay the same year for $1.5 billion. It proved a crucial insight: people would trust a third party to handle their money online, if that third party could be fast, reliable, and secure.

A decade later, in 2010, two brothers from rural Ireland — Patrick and John Collison — saw a different problem. PayPal had made it possible for consumers to pay online, but for developers trying to integrate payments into their applications, the experience was miserable. Existing payment APIs required weeks of paperwork, byzantine XML integrations, and deep knowledge of the financial system. The Collisons built Stripe with a radical premise: accepting a payment should be seven lines of code. Stripe abstracted away the complexity of card networks, acquiring banks, PCI compliance, and currency conversion behind a clean REST API. Meanwhile, Jack Dorsey's Square (founded 2009) attacked the physical point-of-sale market, turning any smartphone into a card terminal. Together, these companies reshaped how money moves and demonstrated that payments infrastructure is one of the most valuable software categories in the world — Stripe is valued at over $50 billion, and PayPal processes over $1.5 trillion in payment volume annually.

In a system design interview, designing a payment system tests several critical skills at once. First, it tests your understanding of exactly-once semantics in a world where networks are unreliable — if a payment request times out, did the charge go through or not? Second, it tests your knowledge of double-entry accounting — a concept from the 1400s that remains the foundation of every modern financial system. Third, it tests your ability to reason about distributed transactions, saga patterns, and state machines. Fourth, it forces you to consider security, compliance (PCI DSS), and fraud detection as first-class architectural concerns rather than afterthoughts. Few system design questions cover this breadth, which is why payment systems carry high interview weight at companies like Stripe, Square, Amazon, and any fintech startup.

---

### Section 2 — Requirements Gathering

Before diving into architecture, a strong interview answer begins with structured requirements gathering. Payment systems are deceptively complex, and clarifying scope early prevents you from designing a system that is either too narrow (just a payment form) or too broad (an entire banking platform).

**Functional Requirements**

The core functional requirements for a payment system like Stripe or PayPal include the following. First, the system must process payments — a merchant submits a charge request with an amount, currency, and payment method, and the system authorizes and captures the funds. Second, the system must support refunds, both full and partial, which reverse a previous charge and return funds to the customer. Third, multi-currency support is essential in a global economy — a merchant in Germany should be able to charge a customer in Japan in JPY, receive a payout in EUR, and the system handles the conversion. Fourth, the system must support multiple payment methods: credit and debit cards (Visa, Mastercard, Amex), bank transfers (ACH in the US, SEPA in Europe), and digital wallets (Apple Pay, Google Pay). Fifth, recurring subscriptions are a major use case — the system must store payment credentials securely and charge customers on a schedule (monthly, annually, usage-based). Sixth, merchant payouts must occur on a regular schedule — the system aggregates successful charges, deducts fees and refunds, and transfers the net amount to the merchant's bank account.

**Non-Functional Requirements**

The non-functional requirements for a payment system are unusually stringent compared to most software. Exactly-once payment processing is the most critical requirement — a customer must never be charged twice for the same purchase, and a payment must never silently disappear. PCI DSS (Payment Card Industry Data Security Standard) compliance is legally required for any system that handles card data; this affects how you store, transmit, and process cardholder information. Availability must be at or near 99.999% (five nines), because payment downtime directly translates to lost revenue for every merchant on the platform — at Stripe's scale, even one minute of downtime costs millions. Payment processing latency should be under one second for the authorization step, because customers abandon purchases when checkout is slow. Finally, a complete audit trail is mandatory — every state transition, every API call, every internal decision must be logged immutably for regulatory compliance, dispute resolution, and debugging.

**Back-of-Envelope Estimation**

Let us size the system with realistic numbers. Assume the platform processes 1 million transactions per day. That translates to roughly 11.6 transactions per second on average (1,000,000 / 86,400). However, payment traffic is heavily skewed — Black Friday or flash sales can produce 10-20x peaks, so we must design for approximately 200 transactions per second sustained peak load, with the ability to burst higher.

For storage, consider the ledger. Each transaction record contains: transaction ID (16 bytes), merchant ID (16 bytes), customer ID (16 bytes), amount (8 bytes), currency (3 bytes), status (1 byte), payment method token (32 bytes), timestamps (16 bytes), metadata/description (256 bytes average), and idempotency key (32 bytes). That is roughly 400 bytes per transaction. With 1M transactions/day, daily storage is 400 MB. Over a year, that is 146 GB for transactions alone. However, ledger entries are doubled (double-entry accounting creates two entries per transaction), so double that to approximately 300 GB/year. Add audit logs (typically 3-5x the size of the core data due to verbose logging of every state change), and you are looking at 1-1.5 TB/year of storage. This is well within the capacity of a properly sharded relational database.

For the average transaction amount, assume $50 (typical for e-commerce). That means $50M in daily payment volume, or roughly $18B annually. With a typical payment processing fee of 2.9% + $0.30 per transaction, the platform's daily revenue would be approximately $1.75M (($50 * 0.029 + $0.30) * 1,000,000). These numbers are realistic for a mid-scale payment processor and help justify the level of infrastructure investment.

Network bandwidth is modest: at 200 TPS peak, with each API request averaging 2 KB and each response 1 KB, peak bandwidth is approximately 600 KB/s — trivial for modern infrastructure. The bottleneck is never bandwidth; it is transactional correctness and latency through external payment networks.

---

### Section 3 — High-Level Architecture

A payment system is not a single monolith — it is a carefully orchestrated set of services, each with a specific responsibility. The high-level architecture separates concerns along trust and compliance boundaries, ensuring that sensitive card data is isolated, business logic is maintainable, and external integrations are abstracted behind clean interfaces.

The primary components are as follows. The **Payment API Gateway** is the entry point for all merchant-facing requests — creating charges, refunds, subscriptions, and querying payment status. It handles authentication (API keys), rate limiting, input validation, and idempotency key extraction. The **Payment Service** is the core orchestrator that manages the payment lifecycle, implements the state machine, and coordinates between internal and external systems. The **Payment Processor Integration Layer** abstracts communication with external payment processors and card networks — it handles the specifics of each card network's protocol (Visa, Mastercard), retry logic, and response normalization. The **Ledger Service** maintains the double-entry accounting records — every movement of money is recorded as a balanced debit and credit. The **Fraud Detection Service** evaluates every transaction in real time for risk signals and can block or flag suspicious activity. The **Notification Service** sends webhooks to merchants and emails/SMS to customers about payment outcomes. The **Reconciliation Service** runs periodically (typically daily) to compare the internal ledger against external bank statements and flag discrepancies.

Below is an ASCII architecture diagram showing the payment flow:

```
                                    +-------------------+
                                    |   Merchant App    |
                                    +--------+----------+
                                             |
                                        API Request
                                    (idempotency key)
                                             |
                                             v
                                    +-------------------+
                                    | Payment API       |
                                    | Gateway           |
                                    | (Auth, Rate Limit,|
                                    |  Validation)      |
                                    +--------+----------+
                                             |
                         +-------------------+-------------------+
                         |                                       |
                         v                                       v
                +--------+----------+               +-----------+-----------+
                | Idempotency       |               | Fraud Detection       |
                | Store             |               | Service               |
                | (Redis/DB)        |               | (Rules + ML Engine)   |
                +---------+---------+               +-----------+-----------+
                          |                                     |
                          +------------------+------------------+
                                             |
                                             v
                                    +--------+----------+
                                    | Payment Service   |
                                    | (State Machine,   |
                                    |  Orchestration)   |
                                    +--------+----------+
                                             |
                    +------------------------+------------------------+
                    |                        |                        |
                    v                        v                        v
           +-------+--------+     +---------+---------+    +---------+---------+
           | Payment        |     | Ledger Service    |    | Notification      |
           | Processor      |     | (Double-Entry     |    | Service           |
           | Integration    |     |  Accounting)      |    | (Webhooks, Email) |
           +-------+--------+     +---------+---------+    +-------------------+
                   |                         |
                   v                         v
        +----------+----------+    +---------+---------+
        | Card Networks       |    | Ledger Database   |
        | (Visa, MC, Amex)    |    | (PostgreSQL)      |
        | Acquirer Bank       |    +-------------------+
        | Issuing Bank        |
        +---------------------+
                                    +-----------------------+
                                    | Reconciliation        |
                                    | Service               |
                                    | (Batch Job, Daily)    |
                                    +-----------+-----------+
                                                |
                                    +-----------+-----------+
                                    | Bank Statements /     |
                                    | Settlement Files      |
                                    +-----------------------+
```

The flow proceeds as follows: a merchant application sends a payment request to the API Gateway, which validates the request and extracts the idempotency key. The gateway checks the idempotency store — if this key has been seen before, it returns the cached result immediately. If not, the request passes through the fraud detection service for risk scoring. If approved, the Payment Service takes over, driving the payment through its state machine. It calls the Payment Processor Integration Layer to communicate with the card network (authorization request flows from acquirer to card network to issuing bank and back). Upon successful authorization, the Ledger Service records the double-entry transaction. The Notification Service informs the merchant via webhook. Later, the Reconciliation Service compares internal records with external settlement files to ensure everything balances.

This architecture intentionally separates the "hot path" (payment processing, which must be fast and reliable) from "warm" paths (fraud detection, which can be slightly async) and "cold" paths (reconciliation, which runs in batch). Each component can be scaled, deployed, and monitored independently.

---

### Section 4 — Deep Dive: Payment Processing Flow

Understanding how a payment actually moves through the financial system is essential for designing (and interviewing about) a payment platform. The card payment lifecycle has three distinct phases: authorization, capture, and settlement. Most engineers are only aware of the first, but all three matter for system design.

**Authorization** is the first step. When a customer clicks "Pay" on a merchant's website, the merchant's backend sends an authorization request to the payment system. The payment system forwards this to an acquirer (the merchant's bank), which routes it through the appropriate card network (Visa, Mastercard, etc.) to the issuing bank (the customer's bank). The issuing bank checks whether the customer has sufficient funds or credit, runs its own fraud checks, and returns an authorization code (approved) or a decline reason. This entire round trip must complete in under one second. Importantly, authorization does not move money — it places a hold on the customer's funds. The money is still in the customer's account; it is just reserved.

**Capture** is the second step. After authorization, the merchant must "capture" the funds — this tells the payment system to actually request the money. For most e-commerce transactions, capture happens immediately after authorization (an "auth-capture" flow). But some use cases separate them: hotels authorize when you book but capture when you check out; gas stations authorize a default amount ($100) but capture the actual pumped amount. The capture request references the original authorization and may be for the same or a lesser amount. The payment system records the capture and queues it for settlement.

**Settlement** is the third step and happens in batch, typically once per day. The acquirer aggregates all captured transactions and submits them to the card networks. The card networks coordinate the actual movement of money between the issuing banks and the acquirer. The acquirer then deposits the net amount (minus fees) into the merchant's bank account. Settlement is where money actually changes hands, and it typically takes 1-3 business days. This delay is a fundamental property of the card payment system and is why merchants do not see funds immediately.

**The Card Payment Network Flow** in more detail:

```
Customer       Merchant       Payment       Acquirer       Card         Issuing
(Browser)      (Server)       System        Bank           Network      Bank
   |               |              |              |             |            |
   |--Pay Request->|              |              |             |            |
   |               |--Charge API->|              |             |            |
   |               |              |--Auth Req--->|             |            |
   |               |              |              |--Auth Req-->|            |
   |               |              |              |             |--Auth Req->|
   |               |              |              |             |            |
   |               |              |              |             |<-Approved--|
   |               |              |              |<-Approved---|            |
   |               |              |<-Approved----|             |            |
   |               |<--Success----|              |             |            |
   |<--Confirm-----|              |              |             |            |
   |               |              |              |             |            |
   |               |              |  (Settlement - Batch, Daily)           |
   |               |              |--Capture---->|             |            |
   |               |              |              |--Settle---->|            |
   |               |              |              |             |--Debit---->|
   |               |              |              |<--Funds-----|            |
   |               |              |              |             |            |
   |               |              |  (Payout to Merchant)      |            |
   |               |<--Payout-----|              |             |            |
```

**3D Secure (3DS) Authentication** adds an additional step for high-risk transactions. When the payment system or the issuing bank determines that extra verification is needed (based on transaction amount, geography, or risk score), the customer is redirected to their bank's 3DS page to enter a one-time password or approve the transaction via their banking app. 3DS shifts liability for fraud from the merchant to the issuing bank — if a 3DS-authenticated transaction turns out to be fraudulent, the merchant is not held responsible for the chargeback. The trade-off is user friction: every additional step in checkout increases cart abandonment. Modern 3DS 2.0 implementations attempt to do this "frictionlessly" by passing device fingerprint data to the issuing bank, which can approve silently if the risk is low.

**Tokenization** is how PCI compliance is maintained at scale. Rather than storing raw card numbers (which would bring enormous PCI DSS scope), the payment system replaces card data with a token — a random string that maps to the card in a highly secured token vault. The token vault is the only component that touches raw card data, and it lives in a locked-down PCI-compliant environment. Everything else in the system — the API, the payment service, the ledger — only ever sees tokens. This dramatically reduces the PCI compliance burden and the blast radius of a data breach. Stripe pioneered the approach of collecting card data directly in an iframe (Stripe Elements) so that the merchant's servers never see the card number at all, further reducing scope.

**PSP (Payment Service Provider) Integration** is the abstraction layer between your payment system and the outside world. A PSP like Stripe or Adyen connects to multiple acquirers and card networks, handles retry logic across different processors, and normalizes the various response formats into a consistent API. When designing a payment system, you must decide whether to integrate directly with card networks (expensive, complex, requires acquiring bank relationships) or use an existing PSP as your processor. Most companies use a PSP; only the largest (Amazon, PayPal themselves) have direct integrations with networks. Your integration layer should support multiple PSPs for redundancy — if one processor is down, route to another.

---

### Section 5 — Idempotency and Exactly-Once Processing

If there is one concept that defines payment system design more than any other, it is idempotency. In an unreliable network, a client may send the same payment request multiple times — the network dropped before the response arrived, the client timed out and retried, or a load balancer replayed the request. Without idempotency, each of those retries could result in a separate charge. Charging a customer twice for a single purchase is one of the most damaging bugs a payment system can have: it destroys trust, triggers chargebacks, and can violate financial regulations. Idempotency guarantees that no matter how many times the same request is sent, the system processes it exactly once and returns the same result.

**Idempotency Key Design** is the mechanism that makes this possible. Every payment API request includes an idempotency key — a unique string (typically a UUID) generated by the client that identifies this specific intent to pay. The payment system stores the idempotency key alongside the request parameters and the result. When a request arrives, the system first checks: "Have I seen this idempotency key before?" If yes, it returns the stored result without re-processing. If no, it processes the request and stores the result keyed by the idempotency key. The storage for idempotency keys must be highly available and fast — Redis is a common choice, with a TTL of 24-72 hours (after which retries are no longer expected). The key must be scoped to the merchant (API key) to prevent collisions between different merchants using the same key value.

There is subtlety in the implementation. What happens if two requests with the same idempotency key arrive simultaneously? The system must use locking — either an optimistic lock (try to insert the key; if it already exists, another request is in flight) or a distributed lock (acquire a lock on the key before processing). If the first request is still in progress when the duplicate arrives, the system should return a 409 Conflict or ask the client to retry later, rather than processing the second request. What happens if the first request fails partway through? The system must store the failure result, so that retries with the same key return the failure rather than attempting to process again with potentially inconsistent state. The client should generate a new idempotency key when making a genuinely new attempt after understanding and addressing the failure.

**Request Deduplication** extends beyond idempotency keys. The system should also detect near-duplicate requests even without an explicit idempotency key — for instance, two charges for the same amount to the same customer within a short window might indicate a double-click on the "Pay" button. This is a softer form of deduplication and is typically implemented as a warning flag rather than an outright block, since legitimate duplicate charges do exist (buying the same product twice intentionally).

**The Payment State Machine** is the backbone of exactly-once processing. Each payment transitions through a defined set of states, and each transition is guarded by preconditions. The canonical states are:

```
                +----------+
                | CREATED  |
                +----+-----+
                     |
              Authorization
                     |
          +----------+-----------+
          |                      |
    +-----v------+        +-----v------+
    | AUTHORIZED |        |  DECLINED  |
    +-----+------+        +------------+
          |
       Capture
          |
    +-----v------+
    |  CAPTURED   |
    +-----+------+
          |
      Settlement
          |
    +-----v------+        +------------+
    |  SETTLED    +------->+  REFUNDED  |
    +-------------+        +-----+------+
                                 |
                           (Partial or Full)
```

Each state transition is atomic and persisted transactionally. A payment in the AUTHORIZED state can only transition to CAPTURED or VOIDED (if the authorization is released). A payment in CAPTURED can only transition to SETTLED or REFUNDED. Attempting an invalid transition (e.g., capturing a payment that is already settled) returns an error. This state machine, combined with idempotency keys, ensures that the system never loses track of where a payment is in its lifecycle, even in the face of crashes, network partitions, or duplicate requests.

**Handling Retries Safely** requires careful coordination between the client and server. The server exposes the state machine status — the client can always query the current state of a payment by its idempotency key or payment ID. If a request times out, the client should first query the state before retrying. If the payment is already in AUTHORIZED or CAPTURED state, the retry is unnecessary. If the payment is in CREATED state (meaning authorization was never attempted or failed), the client can safely retry with the same idempotency key. This query-before-retry pattern significantly reduces the risk of duplicate processing and is a best practice that Stripe documents extensively in their API guidelines.

---

### Section 6 — Double-Entry Ledger

The double-entry bookkeeping system, invented by Luca Pacioli in 1494 (though practiced by Venetian merchants even earlier), is one of the most enduring inventions in human history. Its core principle is beautifully simple: every financial transaction must be recorded as both a debit and a credit of equal amounts. Money never appears from nowhere and never disappears — it always moves from one account to another. This principle is the foundation of every modern financial system, from the smallest startup to the Federal Reserve, and your payment system must implement it rigorously.

In a payment system, the double-entry ledger records the movement of money between accounts. When a customer pays a merchant $100, the ledger records two entries: a $100 debit from the customer's balance (or the PSP's receivable account) and a $100 credit to the merchant's balance. When the platform takes a $2.90 fee, it records a debit from the merchant's balance and a credit to the platform's revenue account. The fundamental invariant is that the sum of all debits always equals the sum of all credits. If this invariant is ever violated, money has been created or destroyed — a catastrophic error.

**Ledger Schema Design** must capture this precisely. A well-designed ledger has at minimum the following tables:

```
accounts:
  id              UUID PRIMARY KEY
  account_type    ENUM('MERCHANT', 'CUSTOMER', 'PLATFORM_REVENUE',
                       'PLATFORM_RECEIVABLE', 'SETTLEMENT')
  currency        CHAR(3)
  balance         DECIMAL(19,4)     -- current balance (denormalized)
  created_at      TIMESTAMP

ledger_entries:
  id              UUID PRIMARY KEY
  transaction_id  UUID NOT NULL     -- groups debit+credit entries
  account_id      UUID REFERENCES accounts(id)
  entry_type      ENUM('DEBIT', 'CREDIT')
  amount          DECIMAL(19,4) NOT NULL  -- always positive
  currency        CHAR(3) NOT NULL
  description     TEXT
  created_at      TIMESTAMP
  -- CONSTRAINT: for each transaction_id, SUM(debits) = SUM(credits)

transactions:
  id              UUID PRIMARY KEY
  payment_id      UUID NOT NULL
  type            ENUM('CHARGE', 'REFUND', 'PAYOUT', 'FEE', 'ADJUSTMENT')
  status          ENUM('PENDING', 'COMPLETED', 'FAILED')
  amount          DECIMAL(19,4)
  currency        CHAR(3)
  created_at      TIMESTAMP
```

The use of `DECIMAL(19,4)` is critical — never use floating-point types for money. Floating-point arithmetic introduces rounding errors that, at scale, cause books to not balance. DECIMAL provides exact arithmetic. The four decimal places accommodate currencies with sub-cent precision requirements (some forex and crypto use cases need more).

**Why Double-Entry Prevents Errors** becomes clear when you consider what happens without it. In a single-entry system, you might record "Customer paid $100 to Merchant." But what if the process crashes after crediting the merchant but before debiting the customer? The merchant has $100, but the customer was never charged — money was created. With double-entry, both entries are written in a single database transaction. Either both succeed or neither does. And because the invariant (total debits = total credits) is always maintained, you can verify the integrity of the entire ledger at any time by running a simple sum query.

**Reconciliation** is the process of comparing the internal ledger against external statements. Every day, the payment system receives settlement files from card networks and bank statements from payout banks. The reconciliation service matches each external entry against an internal ledger entry. Matched entries are marked as reconciled. Unmatched entries are flagged for investigation — they might indicate a processing error, a timing difference (a transaction settled externally but was not yet recorded internally), or, in the worst case, fraud. Reconciliation discrepancies are categorized by severity: timing differences (expected, will resolve in 1-2 days) are low severity, while missing transactions or amount mismatches are high severity and require immediate attention. A mature payment system runs reconciliation multiple times per day and has automated alerting on unresolved discrepancies.

**Handling Discrepancies** requires a systematic approach. When the reconciliation service finds that the internal ledger shows a $100 charge that the bank statement does not reflect, the payment team investigates. Possible causes include: the capture was sent but not yet processed by the bank (timing), the capture failed silently (system error), or the transaction was disputed by the customer before settlement (chargeback). Each cause has a different resolution — wait, re-submit, or record the chargeback. The key design principle is that the ledger is the system of record, and any discrepancy between the ledger and external statements must be resolved by adjusting entries (creating new corrective entries) rather than modifying historical entries. Ledger entries are append-only and immutable — you never edit a past entry; you create a new adjustment entry that offsets it.

---

### Section 7 — Fraud Detection

Fraud is the existential threat to any payment system. PayPal nearly went bankrupt in its early days because fraud losses exceeded revenue — organized crime rings discovered they could create fake accounts, generate fraudulent transactions, and drain the system. Stripe reports that fraud costs the global economy over $30 billion annually. A payment system without robust fraud detection is not just vulnerable; it is irresponsible. At the same time, overly aggressive fraud prevention blocks legitimate customers and drives away business. The art of fraud detection is finding the right balance between security and conversion.

**Rule-Based Checks** are the first line of defense. These are deterministic rules that flag or block transactions based on known risk patterns. Velocity checks limit the number of transactions from a single card, IP address, or customer within a time window — a card that is used 50 times in an hour is almost certainly stolen. Amount thresholds flag unusually large transactions — if a merchant's average transaction is $30, a sudden $5,000 charge warrants scrutiny. Geographic anomalies detect impossible travel — a card used in New York at 2:00 PM and in London at 2:05 PM is physically impossible and almost certainly fraudulent. BIN (Bank Identification Number) checks identify cards from high-risk countries or banks. Device fingerprinting detects when the same device is being used with multiple different cards. Rule-based systems are fast (sub-millisecond evaluation), interpretable (you can explain exactly why a transaction was blocked), and easy to update. Their weakness is that they are static — sophisticated fraudsters learn the rules and adapt.

**ML-Based Fraud Scoring** provides the adaptive layer. Machine learning models are trained on historical transaction data labeled as legitimate or fraudulent. Features include transaction amount, time of day, merchant category, customer purchase history, device information, IP geolocation, card velocity, and hundreds of other signals. The model outputs a fraud probability score (e.g., 0.0 to 1.0), and transactions above a threshold are blocked or sent for manual review. The most effective models use gradient-boosted trees (XGBoost, LightGBM) or neural networks trained on millions of labeled transactions. The challenge is the class imbalance — fraud is rare (typically 0.1-0.5% of transactions), so the model must be carefully calibrated to avoid excessive false positives. A model that blocks 10% of legitimate transactions to catch 90% of fraud is destroying more value than it saves.

**3D Secure for High-Risk Transactions** is a powerful tool because it shifts liability. When the fraud detection service identifies a transaction as medium-to-high risk (not obviously fraudulent, but suspicious), it can trigger 3D Secure authentication. The customer must verify their identity with their bank, and if the transaction is later found to be fraudulent, the liability falls on the issuing bank rather than the merchant. This is a strategic tool — using 3DS on every transaction would destroy conversion rates, but using it selectively on risky transactions provides security where it is needed most.

**Chargeback Handling** is the fallback when fraud prevention fails. A chargeback occurs when a customer disputes a charge with their issuing bank. The bank provisionally credits the customer and notifies the merchant (through the payment system) of the dispute. The merchant has a window (typically 7-21 days) to provide evidence that the charge was legitimate (delivery confirmation, signed receipts, communication logs). If the evidence is compelling, the chargeback is reversed; if not, the merchant loses the funds plus a chargeback fee ($15-$25 typically). High chargeback rates (above 1% of transactions) can result in the merchant being placed in monitoring programs or losing the ability to accept cards entirely. The payment system must track chargeback rates per merchant and proactively intervene when rates approach dangerous thresholds.

**Balancing Prevention and Friction** is ultimately a business decision encoded in the system's configuration. The fraud detection service should be tunable per merchant — a luxury goods retailer selling $10,000 watches has a different risk profile than a coffee shop selling $5 lattes. The system should expose controls: fraud score thresholds, rule configurations, 3DS trigger conditions, and velocity limits. Some merchants prefer to accept more fraud in exchange for higher conversion (the profit from additional legitimate sales exceeds the fraud losses). Others, particularly those selling digital goods (which are impossible to recover once delivered), demand tight fraud controls. The payment system's job is to provide the infrastructure and intelligence; the merchant's job is to set the policy.

---

### Section 8 — Reliability and Consistency

Payment systems have among the strictest reliability requirements of any software system. A social media platform can tolerate a few seconds of inconsistency (your like count might be briefly wrong). A payment system cannot — even momentary inconsistency can result in double charges, lost funds, or regulatory violations. This section covers the techniques that ensure a payment system remains correct and available even in the face of hardware failures, network partitions, and software bugs.

**Distributed Transactions with the Saga Pattern** are essential because a payment involves multiple services (payment service, ledger, fraud detection, external PSP) and no single database transaction can span all of them. The saga pattern decomposes the payment into a sequence of local transactions, each with a compensating transaction that undoes its work if a later step fails. For a payment, the saga might look like this: (1) Create payment record (compensate: mark as FAILED), (2) Run fraud check (compensate: release fraud hold), (3) Authorize with PSP (compensate: void authorization), (4) Record ledger entries (compensate: create reversing entries), (5) Send notification (no compensation needed — idempotent). If step 3 fails (PSP declines the card), the saga executes compensating actions for steps 1 and 2. The saga coordinator — which can be orchestration-based (a central service drives the steps) or choreography-based (each service emits events that trigger the next step) — ensures that the payment either completes fully or is fully rolled back.

**Handling Partial Failures** is one of the hardest problems in payment systems. Consider this scenario: the system sends an authorization request to the PSP, and the network connection drops before the response arrives. Did the authorization succeed or fail? The system does not know. If it assumes failure and retries, the customer might be double-authorized (their funds are held twice). If it assumes success and proceeds to capture, the capture will fail because there is no valid authorization. The correct approach is: (1) record the uncertain state (AUTHORIZATION_PENDING) in the database, (2) query the PSP for the authorization status (most PSPs provide a status inquiry API), (3) based on the response, either proceed or retry. This "check then act" pattern, combined with idempotency keys, handles the majority of partial failure scenarios.

**Timeout Handling** must be calibrated carefully. The authorization step involves external network calls to the PSP, acquirer, card network, and issuing bank. Each hop adds latency, and any hop can time out. The payment system should set aggressive but not too tight timeouts — too short (1 second) causes false timeouts on slow but ultimately successful authorizations; too long (30 seconds) causes the customer to wait unacceptably. A typical configuration is 5-10 seconds for the end-to-end authorization, with shorter timeouts (2-3 seconds) at each internal hop. When a timeout occurs, the system must not assume the operation failed — it must follow the "uncertain state" handling described above.

**Dead Letter Queues (DLQs)** capture failed payments that cannot be processed after all retries are exhausted. Rather than silently dropping them, the system routes them to a dead letter queue for manual review or automated reconciliation. DLQ entries are monitored and alerted on — a growing DLQ indicates a systemic problem (PSP outage, database issue, bug in the payment flow). The operations team reviews DLQ entries daily and either reprocesses them (if the underlying issue is resolved) or marks them as permanently failed with an explanation.

**Reconciliation Jobs** run continuously in the background to verify system integrity. Beyond the external reconciliation described in Section 6, internal reconciliation checks include: (1) verifying that every AUTHORIZED payment was either CAPTURED, VOIDED, or expired within the authorization window (typically 7 days), (2) verifying that every ledger transaction balances (total debits = total credits), (3) verifying that every merchant's computed balance matches the sum of their ledger entries, (4) verifying that the total of all merchant balances plus platform revenue equals the total funds received from card networks. These jobs are the safety net — even if the real-time processing has a bug, reconciliation will catch the discrepancy before it causes real harm.

**Multi-Region Active-Active Considerations** are necessary for five-nines availability. A single-region deployment is a single point of failure — if the region goes down, all payment processing stops. An active-active multi-region deployment allows payments to be processed in any region, but introduces the challenge of data consistency. The recommended approach for payment systems is to use a single primary region for the ledger (strong consistency) with fast failover to a standby region, while allowing the API gateway and fraud detection to run active-active in multiple regions. This hybrid approach provides high availability without risking ledger inconsistency. Some systems achieve true multi-region active-active by partitioning merchants across regions — merchant A's payments always process in US-East, merchant B's in EU-West — eliminating cross-region consistency requirements.

---

### Section 9 — Trade-Offs and Design Decisions

Every payment system design involves trade-offs. Understanding and articulating these trade-offs is what separates a good interview answer from a great one. This section presents the key design decisions you will face and the reasoning behind each choice.

**Synchronous vs. Asynchronous Payment Processing** is the first major decision. In synchronous processing, the API call blocks until the payment is fully authorized (or declined), and the merchant receives the result immediately. In asynchronous processing, the API call returns immediately with a "pending" status, and the merchant is notified via webhook when the payment completes. Synchronous processing provides better user experience (the customer knows immediately whether their payment succeeded) and simpler merchant integration. Asynchronous processing provides better resilience (the system can queue and retry without holding open connections) and supports payment methods with inherently async flows (bank transfers, which can take days). The pragmatic approach is to use synchronous processing for card payments (where authorization is fast) and asynchronous processing for bank transfers and other slow methods, using webhooks to notify merchants of final outcomes in both cases.

**Strong vs. Eventual Consistency for Balances** affects how quickly merchants see their balance update. With strong consistency, the merchant's balance is updated in the same database transaction as the ledger entry — the balance is always correct but writes are serialized and potentially slow. With eventual consistency, ledger entries are written immediately, and balances are computed asynchronously (or on read, by summing ledger entries). Eventual consistency allows higher write throughput but means the displayed balance might be momentarily stale. For a payment system, the ledger itself must be strongly consistent (you cannot have a partial ledger entry), but the derived balance can be eventually consistent — it is acceptable for a merchant's dashboard to show a balance that is a few seconds behind reality, as long as the ledger is correct.

**Build vs. Buy Payment Processing** is a business and architectural decision. Building your own payment processing stack (direct integration with card networks, acquiring bank relationships) gives you full control, lower per-transaction costs at scale, and the ability to customize every aspect of the flow. But it requires PCI Level 1 certification, significant engineering investment, and years of operational expertise. Buying — using an existing PSP like Stripe, Adyen, or Braintree — gets you to market in days, handles PCI compliance, and provides battle-tested reliability. The trade-off is higher per-transaction fees and less control. Most companies start with a PSP and consider building only when their transaction volume makes the per-transaction cost savings justify the engineering investment (typically billions of dollars in annual volume).

**PCI Scope Minimization** is not just a compliance checkbox — it is an architectural strategy that affects every component of the system. PCI DSS has four levels of compliance based on transaction volume, with Level 1 (over 6 million transactions/year) being the most stringent. The key insight is that PCI scope applies only to systems that store, process, or transmit cardholder data. By using tokenization and collecting card data in iframes hosted by the PSP, you can reduce your PCI scope to SAQ-A (the simplest level), which requires only a self-assessment questionnaire rather than a full audit. This architectural decision — never letting raw card data touch your servers — should be made at design time and enforced ruthlessly.

**Currency Conversion Timing** affects both user experience and financial risk. You can convert currencies at authorization time (the customer sees the exact amount in their currency before confirming) or at settlement time (the conversion happens when funds are actually moved, potentially days later). Authorization-time conversion provides price certainty for the customer but exposes the platform to forex risk during the settlement window — if the exchange rate moves unfavorably, the platform loses money. Settlement-time conversion exposes the customer to rate uncertainty but eliminates platform forex risk. Most consumer-facing payment systems convert at authorization time (transparency is paramount) and hedge the forex risk using financial instruments or by building a small markup into the exchange rate.

**Real-Time vs. Batch Settlement** determines how quickly merchants receive their funds. Real-time settlement (instant payouts) is increasingly expected by merchants, especially in the gig economy (drivers want their earnings immediately). But it requires maintaining reserves (you are paying out before the card network settles with you), which ties up capital and introduces risk (what if the transaction is later charged back?). Batch settlement (daily or weekly payouts) is simpler, less risky, and more capital-efficient, but merchants must wait. The trend in the industry is toward faster settlement — Stripe offers "Instant Payouts" for an additional fee, and some markets (Brazil, India) have national real-time payment systems (Pix, UPI) that make instant settlement the default. A well-designed payment system should support both batch and real-time settlement as configurable options.

---

### Section 10 — Interview Questions

**Beginner Tier**

**Q1: What is an idempotency key, and why is it critical in a payment system?**

An idempotency key is a unique identifier (typically a UUID) that a client includes with every payment request to ensure that the same request, if sent multiple times, is processed exactly once. It is critical because network failures, timeouts, and client retries are inevitable in distributed systems. Without idempotency, a retry could result in charging a customer twice for the same purchase. The server stores the idempotency key along with the request result. When a duplicate request arrives, the server recognizes the key, skips processing, and returns the cached result. The key should be scoped per merchant and have a TTL (typically 24-72 hours). Implementation requires an atomic "check-and-set" operation — the system must atomically check whether the key exists and, if not, claim it before processing begins — to handle concurrent duplicate requests correctly.

**Q2: Explain the difference between authorization and capture in card payments.**

Authorization and capture are two distinct phases of a card payment. Authorization is a real-time request to the issuing bank asking "Does this customer have $X available?" If yes, the bank places a hold on those funds and returns an authorization code. No money moves during authorization — funds are simply reserved. Capture is a subsequent request that says "I confirm this charge — please actually transfer the funds." Capture is typically batched and settled through the card network within 1-3 business days. The two-phase approach exists because some merchants need a gap between them: a hotel authorizes at booking but captures at checkout (the final amount may differ from the original authorization due to minibar charges or room upgrades). In standard e-commerce, authorization and capture happen back-to-back, but the system must support them as separate operations.

**Q3: Why should you never use floating-point numbers to represent money?**

Floating-point numbers (float, double) use binary representation that cannot exactly represent most decimal fractions. For example, 0.1 in binary floating-point is actually 0.1000000000000000055511151231257827021181583404541015625. These tiny rounding errors accumulate over thousands of transactions and cause ledger imbalances — the total debits will not equal the total credits. In a payment system, even a $0.01 discrepancy is a critical accounting error that must be investigated and resolved. The correct approach is to use DECIMAL types in databases (e.g., DECIMAL(19,4) in SQL) and arbitrary-precision decimal libraries in application code. Alternatively, some systems represent money as integers in the smallest currency unit (cents for USD, so $10.50 becomes 1050), which eliminates decimal arithmetic entirely.

**Mid Tier**

**Q4: How would you design the double-entry ledger for a payment system?**

The double-entry ledger requires three core tables: accounts (representing entities that hold money — merchants, customers, the platform itself, settlement accounts), ledger_entries (individual debit or credit records), and transactions (grouping related ledger entries). Every financial event creates at least two ledger entries that sum to zero. For a $100 charge with a 2.9% + $0.30 fee: (1) Debit the platform receivable account $100 (money owed from the card network), (2) Credit the merchant balance account $97.20 (net after fee), (3) Credit the platform revenue account $2.80 (the fee). The invariant is that across all entries for a given transaction, debits equal credits. Ledger entries are immutable — you never modify a past entry; corrections are made by creating new reversing entries. The merchant's displayed balance is derived by summing all credit and debit entries for their account. Reconciliation jobs periodically verify the global invariant (sum of all debits = sum of all credits across the entire ledger) and flag violations for immediate investigation.

**Q5: Describe the saga pattern as applied to payment processing.**

The saga pattern breaks a distributed transaction into a sequence of local transactions, each with a compensating action. For payment processing, the saga steps are: (1) Create payment record in CREATED state, (2) Execute fraud check — if flagged, compensate by marking payment FAILED, (3) Send authorization to PSP — if declined, compensate by marking payment FAILED, (4) Write ledger entries — if this fails, compensate by voiding the PSP authorization, (5) Update payment state to AUTHORIZED, (6) Capture the payment — if capture fails, void the authorization and create reversing ledger entries. The saga can be orchestrated (a central coordinator calls each service in sequence) or choreographed (each service publishes events that trigger the next step). Orchestration is preferred for payments because the flow is complex and needs centralized visibility. The coordinator persists the saga's current step, so if it crashes, it can resume from the last completed step. Timeout-based monitoring detects stuck sagas and triggers either retries or compensation.

**Q6: How do you handle the case where a payment authorization request times out?**

This is one of the hardest problems in payment systems because the timeout creates genuine uncertainty — the authorization may have succeeded, failed, or still be in progress at the PSP. The correct approach is: (1) Record the payment state as AUTHORIZATION_PENDING in the database. (2) Do NOT retry the authorization immediately — this risks double-authorization. (3) Query the PSP's status API using the original idempotency key or transaction reference to determine the actual outcome. (4) If the PSP confirms success, proceed to update state to AUTHORIZED. If the PSP confirms failure, update to FAILED. If the PSP is also uncertain (which happens), schedule a retry of the status query with exponential backoff. (5) Set a maximum resolution time (e.g., 30 minutes); if the state is still uncertain after that, void any possible authorization (send a void request, which is safe to send even if the authorization did not succeed) and mark the payment as FAILED. (6) Notify the merchant via webhook once the final state is determined. This pattern ensures that the system always reaches a definitive state and never leaves money in limbo.

**Senior Tier**

**Q7: How would you design multi-region active-active payment processing while maintaining ledger consistency?**

True active-active payment processing across regions while maintaining ledger consistency is one of the hardest distributed systems problems. The approach I would recommend partitions the problem by data ownership. Merchants are assigned to a primary region based on their geographic location or signup region. All ledger writes for a given merchant go to their primary region's database, ensuring strong consistency within a merchant's financial data. The API gateway and fraud detection service run active-active in all regions — a request from any region is routed to the merchant's primary region for the actual payment processing. If the primary region is down, the system has two options: (a) fail the payment (prioritize consistency over availability) or (b) fail over to a secondary region that has a synchronous replica of the merchant's data. Option (b) provides higher availability but requires synchronous cross-region replication, which adds latency (50-100ms per write for cross-continental replication). The trade-off depends on the business: for a system processing high-value transactions where a double charge is catastrophic, consistency (option a) is preferred. For high-volume, low-value transactions, availability (option b) with post-hoc reconciliation may be acceptable. CockroachDB or Google Spanner can provide globally consistent transactions at the cost of write latency.

**Q8: Design a reconciliation system that handles discrepancies between your internal ledger and bank settlement files at scale.**

The reconciliation system must handle millions of transactions daily and detect discrepancies within hours. The architecture has three layers: ingestion, matching, and resolution. The ingestion layer parses settlement files from card networks (Visa TC files, Mastercard IPM files) and bank statements (MT940 format), normalizing them into a common format. The matching engine runs as a batch job (or streaming, for near-real-time reconciliation) that joins internal ledger entries with external settlement records on transaction reference IDs. Matches fall into four categories: (1) Matched — internal and external records agree on amount, date, and status; (2) Amount mismatch — records match on reference but differ in amount (possible currency conversion issue or partial capture); (3) Missing external — present in internal ledger but absent from settlement file (possible settlement delay, or capture was not submitted); (4) Missing internal — present in settlement file but absent from internal ledger (possible direct charge from the PSP, or a system bug that lost the internal record). Each category triggers different automated workflows: matched entries are marked reconciled; amount mismatches generate alerts for the finance team; missing external entries are retried or investigated after a grace period; missing internal entries trigger emergency investigation. The system maintains a reconciliation dashboard showing the percentage of matched vs. unmatched entries per day, with SLAs (e.g., 99.5% of entries must reconcile within 24 hours). At scale, the matching engine uses partitioned batch processing (partition by merchant or date) to parallelize the work.

**Q9: How would you design a payment system to minimize PCI DSS scope while still supporting features like saved cards and recurring payments?**

PCI scope minimization requires ensuring that cardholder data (PAN, CVV, expiration date) never touches your servers. The architecture uses three key techniques. First, card collection happens entirely client-side using hosted fields or iframes — Stripe Elements, Braintree Hosted Fields, or Adyen's Secured Fields embed the card input form in an iframe served from the PSP's domain. The card data goes directly from the customer's browser to the PSP, bypassing your servers entirely. Your server receives only a token (a reference to the card stored in the PSP's PCI-compliant vault). Second, for saved cards and recurring payments, you store only the token and card metadata (last four digits, expiration date, card brand) — enough to display to the customer, but not enough to make a charge. When a recurring charge is needed, you send the token to the PSP, which resolves it to the actual card and processes the payment. Third, for network tokenization (a newer approach), the card networks themselves issue tokens that replace the PAN. Network tokens have higher authorization rates and automatically update when a card is reissued. This architecture reduces your PCI scope to SAQ-A (the simplest tier), requiring only a self-assessment questionnaire rather than a full on-site audit. The residual PCI requirements include securing API keys, using TLS for all communication, and maintaining access controls — standard security practices that are far less burdensome than the full PCI DSS assessment required when handling raw card data.

---

### Section 11 — Complete Code Example

This section provides a comprehensive implementation of a payment processing system with idempotency, state machine transitions, double-entry ledger operations, and refund handling. We start with pseudocode to establish the logic, then provide a full Node.js implementation.

**Pseudocode: Payment Processing Core**

```
// Pseudocode: Payment Processing with Idempotency and State Machine

ENUM PaymentState:
    CREATED, AUTHORIZED, CAPTURED, SETTLED, FAILED, REFUNDED, PARTIALLY_REFUNDED

FUNCTION processPayment(merchantId, idempotencyKey, amount, currency, paymentMethod):
    // Step 1: Check idempotency
    existingResult = idempotencyStore.get(merchantId, idempotencyKey)
    IF existingResult IS NOT NULL:
        RETURN existingResult    // Return cached result for duplicate request

    // Step 2: Acquire idempotency lock to prevent concurrent duplicates
    lockAcquired = idempotencyStore.tryLock(merchantId, idempotencyKey, TTL=30s)
    IF NOT lockAcquired:
        RETURN Error(409, "Concurrent request in progress for this idempotency key")

    TRY:
        // Step 3: Create payment record in CREATED state
        payment = database.insert(Payment{
            id: generateUUID(),
            merchantId: merchantId,
            amount: amount,
            currency: currency,
            paymentMethod: paymentMethod,
            state: CREATED,
            idempotencyKey: idempotencyKey,
            createdAt: now()
        })

        // Step 4: Run fraud detection
        fraudResult = fraudService.evaluate(payment)
        IF fraudResult.score > FRAUD_THRESHOLD:
            payment.state = FAILED
            payment.failureReason = "Flagged by fraud detection"
            database.update(payment)
            result = PaymentResult(success=false, payment=payment)
            idempotencyStore.set(merchantId, idempotencyKey, result, TTL=24h)
            RETURN result

        // Step 5: Authorize with PSP
        authResponse = psp.authorize(payment)
        IF authResponse.status == "declined":
            payment.state = FAILED
            payment.failureReason = authResponse.declineReason
            database.update(payment)
            result = PaymentResult(success=false, payment=payment)
            idempotencyStore.set(merchantId, idempotencyKey, result, TTL=24h)
            RETURN result

        // Step 6: Update state to AUTHORIZED
        payment.state = AUTHORIZED
        payment.authorizationCode = authResponse.authCode
        database.update(payment)

        // Step 7: Capture immediately (for standard e-commerce flow)
        captureResponse = psp.capture(payment.authorizationCode, amount)
        IF captureResponse.status == "success":
            payment.state = CAPTURED
            database.update(payment)

            // Step 8: Record double-entry ledger
            ledger.recordTransaction(
                transactionId: payment.id,
                entries: [
                    LedgerEntry(account=PLATFORM_RECEIVABLE, type=DEBIT, amount=amount),
                    LedgerEntry(account=merchantAccount(merchantId), type=CREDIT, amount=amount - fee),
                    LedgerEntry(account=PLATFORM_REVENUE, type=CREDIT, amount=fee)
                ]
            )

            // Step 9: Send notification
            notificationService.sendWebhook(merchantId, "payment.captured", payment)

            result = PaymentResult(success=true, payment=payment)
            idempotencyStore.set(merchantId, idempotencyKey, result, TTL=24h)
            RETURN result
        ELSE:
            // Capture failed — void the authorization
            psp.void(payment.authorizationCode)
            payment.state = FAILED
            payment.failureReason = "Capture failed"
            database.update(payment)
            result = PaymentResult(success=false, payment=payment)
            idempotencyStore.set(merchantId, idempotencyKey, result, TTL=24h)
            RETURN result

    FINALLY:
        idempotencyStore.releaseLock(merchantId, idempotencyKey)


FUNCTION processRefund(paymentId, amount):
    payment = database.getById(paymentId)

    // Validate state: can only refund CAPTURED or SETTLED payments
    IF payment.state NOT IN [CAPTURED, SETTLED, PARTIALLY_REFUNDED]:
        RETURN Error(400, "Payment cannot be refunded in current state")

    // Validate amount: cannot refund more than original minus already refunded
    totalRefunded = database.sumRefunds(paymentId)
    IF amount > (payment.amount - totalRefunded):
        RETURN Error(400, "Refund amount exceeds remaining balance")

    // Process refund with PSP
    refundResponse = psp.refund(payment.authorizationCode, amount)
    IF refundResponse.status == "success":
        // Record refund in ledger (reverse the original entries)
        ledger.recordTransaction(
            transactionId: generateUUID(),
            entries: [
                LedgerEntry(account=merchantAccount(payment.merchantId), type=DEBIT, amount=amount),
                LedgerEntry(account=PLATFORM_RECEIVABLE, type=CREDIT, amount=amount)
            ]
        )

        // Update payment state
        newTotalRefunded = totalRefunded + amount
        IF newTotalRefunded == payment.amount:
            payment.state = REFUNDED
        ELSE:
            payment.state = PARTIALLY_REFUNDED
        database.update(payment)

        RETURN RefundResult(success=true, amount=amount)
    ELSE:
        RETURN RefundResult(success=false, reason=refundResponse.error)
```

The pseudocode above establishes the core logic. Each step is intentional: idempotency is checked first (cheapest operation), then fraud (avoids hitting the PSP for obviously bad transactions), then authorization, then capture, then ledger recording. This ordering minimizes wasted work when a request is rejected early.

**Node.js Implementation**

```javascript
// payment-system.js
// Full implementation of payment processing with idempotency,
// state machine, double-entry ledger, and refund handling.

const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const { Pool } = require('pg');

// ---------------------------------------------------------------
// Configuration and connection setup
// ---------------------------------------------------------------

// PostgreSQL connection pool for persistent storage (ledger, payments)
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  database: 'payments',
  user: process.env.DB_USER || 'payments_service',
  password: process.env.DB_PASSWORD,
  max: 20,                    // Maximum pool size for concurrent queries
  idleTimeoutMillis: 30000,   // Close idle connections after 30 seconds
});

// Redis for idempotency store and distributed locking
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  maxRetriesPerRequest: 3,    // Retry failed Redis commands up to 3 times
});

// ---------------------------------------------------------------
// Constants: Payment states and valid transitions
// ---------------------------------------------------------------

// All possible states a payment can be in
const PaymentState = {
  CREATED: 'CREATED',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  SETTLED: 'SETTLED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
};

// State machine: defines which transitions are legal.
// Key is the current state; value is an array of allowed next states.
// Any transition not listed here will be rejected.
const VALID_TRANSITIONS = {
  [PaymentState.CREATED]: [PaymentState.AUTHORIZED, PaymentState.FAILED],
  [PaymentState.AUTHORIZED]: [PaymentState.CAPTURED, PaymentState.FAILED],
  [PaymentState.CAPTURED]: [
    PaymentState.SETTLED,
    PaymentState.REFUNDED,
    PaymentState.PARTIALLY_REFUNDED,
  ],
  [PaymentState.SETTLED]: [
    PaymentState.REFUNDED,
    PaymentState.PARTIALLY_REFUNDED,
  ],
  [PaymentState.PARTIALLY_REFUNDED]: [
    PaymentState.REFUNDED,
    PaymentState.PARTIALLY_REFUNDED, // Additional partial refunds
  ],
  [PaymentState.FAILED]: [],     // Terminal state — no transitions out
  [PaymentState.REFUNDED]: [],   // Terminal state — no transitions out
};

// ---------------------------------------------------------------
// State machine transition validator
// ---------------------------------------------------------------

// Validates and executes a state transition for a payment.
// Throws an error if the transition is not allowed by the state machine.
function validateTransition(currentState, newState) {
  const allowed = VALID_TRANSITIONS[currentState] || [];
  if (!allowed.includes(newState)) {
    throw new Error(
      `Invalid state transition: ${currentState} -> ${newState}. ` +
      `Allowed transitions from ${currentState}: [${allowed.join(', ')}]`
    );
  }
}

// ---------------------------------------------------------------
// Idempotency service: prevents duplicate payment processing
// ---------------------------------------------------------------

class IdempotencyService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.LOCK_TTL_SECONDS = 30;      // Lock expires after 30 seconds
    this.RESULT_TTL_SECONDS = 86400;  // Cached results expire after 24 hours
  }

  // Build a namespaced key to prevent collisions between merchants
  _key(merchantId, idempotencyKey) {
    return `idempotency:${merchantId}:${idempotencyKey}`;
  }

  // Check if a result already exists for this idempotency key.
  // Returns the cached result or null if this is a new request.
  async getExistingResult(merchantId, idempotencyKey) {
    const key = this._key(merchantId, idempotencyKey);
    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached); // Return the previously computed result
    }
    return null;
  }

  // Attempt to acquire a distributed lock for this idempotency key.
  // Uses Redis SET NX (set if not exists) for atomic lock acquisition.
  // Returns true if the lock was acquired, false if another request holds it.
  async tryLock(merchantId, idempotencyKey) {
    const lockKey = `${this._key(merchantId, idempotencyKey)}:lock`;
    // SET key value NX EX ttl — atomic "set if not exists" with expiration
    const result = await this.redis.set(
      lockKey,
      'locked',
      'EX',
      this.LOCK_TTL_SECONDS,
      'NX'
    );
    return result === 'OK'; // 'OK' means lock was acquired
  }

  // Store the final result so that future duplicate requests get this response.
  async storeResult(merchantId, idempotencyKey, result) {
    const key = this._key(merchantId, idempotencyKey);
    await this.redis.set(
      key,
      JSON.stringify(result),
      'EX',
      this.RESULT_TTL_SECONDS
    );
  }

  // Release the distributed lock after processing completes.
  async releaseLock(merchantId, idempotencyKey) {
    const lockKey = `${this._key(merchantId, idempotencyKey)}:lock`;
    await this.redis.del(lockKey);
  }
}

// ---------------------------------------------------------------
// Ledger service: double-entry accounting
// ---------------------------------------------------------------

class LedgerService {
  constructor(dbPool) {
    this.db = dbPool;
  }

  // Record a balanced set of ledger entries within a single DB transaction.
  // Validates that total debits equal total credits before committing.
  // This is the core of double-entry accounting: money never appears
  // or disappears; it only moves between accounts.
  async recordTransaction(transactionId, paymentId, type, entries) {
    const client = await this.db.connect(); // Get a client from the pool
    try {
      await client.query('BEGIN'); // Start a database transaction

      // Validation: verify that debits and credits balance.
      // Sum all debits and all credits; they must be equal.
      let totalDebits = 0;
      let totalCredits = 0;
      for (const entry of entries) {
        if (entry.type === 'DEBIT') {
          totalDebits += entry.amount;
        } else {
          totalCredits += entry.amount;
        }
      }

      // Use a small epsilon for floating point comparison safety,
      // though we use integer cents internally to avoid this issue.
      if (Math.abs(totalDebits - totalCredits) > 0.001) {
        throw new Error(
          `Unbalanced transaction: debits=${totalDebits}, credits=${totalCredits}. ` +
          `Double-entry requires debits to equal credits.`
        );
      }

      // Insert the transaction record that groups these entries
      await client.query(
        `INSERT INTO transactions (id, payment_id, type, status, amount, currency, created_at)
         VALUES ($1, $2, $3, 'COMPLETED', $4, $5, NOW())`,
        [transactionId, paymentId, type, totalDebits, entries[0].currency]
      );

      // Insert each individual ledger entry
      for (const entry of entries) {
        await client.query(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, entry_type, amount, currency, description, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            uuidv4(),             // Unique ID for this ledger entry
            transactionId,        // Links to the parent transaction
            entry.accountId,      // Which account is debited/credited
            entry.type,           // 'DEBIT' or 'CREDIT'
            entry.amount,         // Amount (always positive)
            entry.currency,       // ISO 4217 currency code
            entry.description,    // Human-readable description
          ]
        );

        // Update the account's running balance.
        // Credits increase the balance; debits decrease it.
        // Using a single UPDATE with arithmetic ensures atomicity.
        const balanceChange = entry.type === 'CREDIT' ? entry.amount : -entry.amount;
        await client.query(
          `UPDATE accounts SET balance = balance + $1 WHERE id = $2`,
          [balanceChange, entry.accountId]
        );
      }

      await client.query('COMMIT'); // Commit all entries atomically
    } catch (error) {
      await client.query('ROLLBACK'); // Roll back on any error
      throw error;                     // Re-throw so caller knows it failed
    } finally {
      client.release(); // Return the client to the connection pool
    }
  }
}

// ---------------------------------------------------------------
// Fraud detection service (simplified rule-based implementation)
// ---------------------------------------------------------------

class FraudDetectionService {
  // Evaluate a payment for fraud risk.
  // Returns a score between 0.0 (no risk) and 1.0 (certain fraud).
  // In production, this would call an ML model and check many more signals.
  async evaluate(payment) {
    let score = 0.0;

    // Rule 1: Very large amounts are suspicious.
    // Transactions over $10,000 get a risk bump.
    if (payment.amount > 10000) {
      score += 0.3;
    }

    // Rule 2: Velocity check — too many transactions in a short period.
    // Query recent transactions for this payment method in the last hour.
    const recentCount = await this._getRecentTransactionCount(
      payment.paymentMethodToken,
      60 * 60 // 1 hour window
    );
    if (recentCount > 10) {
      score += 0.4; // High velocity is a strong fraud signal
    } else if (recentCount > 5) {
      score += 0.2; // Moderate velocity is a weaker signal
    }

    // Rule 3: Cross-border transaction.
    // Merchant country differs from card issuing country.
    if (payment.merchantCountry !== payment.cardIssuingCountry) {
      score += 0.1;
    }

    // Cap score at 1.0
    return { score: Math.min(score, 1.0), rules_triggered: [] };
  }

  async _getRecentTransactionCount(paymentMethodToken, windowSeconds) {
    const result = await db.query(
      `SELECT COUNT(*) FROM payments
       WHERE payment_method_token = $1
       AND created_at > NOW() - INTERVAL '${windowSeconds} seconds'`,
      [paymentMethodToken]
    );
    return parseInt(result.rows[0].count, 10);
  }
}

// ---------------------------------------------------------------
// PSP (Payment Service Provider) client — abstracts external processor
// ---------------------------------------------------------------

class PSPClient {
  // Send an authorization request to the payment processor.
  // In production, this calls the PSP's API (e.g., Stripe, Adyen).
  async authorize(payment) {
    try {
      // Simulated PSP call — replace with actual HTTP request
      const response = await this._callPSP('/authorize', {
        amount: payment.amount,
        currency: payment.currency,
        token: payment.paymentMethodToken,
        merchantRef: payment.id,
      });
      return {
        status: response.approved ? 'approved' : 'declined',
        authCode: response.authorizationCode,
        declineReason: response.declineReason || null,
      };
    } catch (error) {
      // Network errors are treated as uncertain — not as declines
      return { status: 'error', error: error.message };
    }
  }

  // Capture previously authorized funds
  async capture(authCode, amount) {
    try {
      const response = await this._callPSP('/capture', {
        authorizationCode: authCode,
        amount: amount,
      });
      return { status: response.success ? 'success' : 'failed' };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  // Refund a captured/settled payment
  async refund(authCode, amount) {
    try {
      const response = await this._callPSP('/refund', {
        authorizationCode: authCode,
        amount: amount,
      });
      return {
        status: response.success ? 'success' : 'failed',
        error: response.error || null,
      };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  // Void an authorization (release the hold without capturing)
  async void(authCode) {
    await this._callPSP('/void', { authorizationCode: authCode });
  }

  // Placeholder for actual HTTP call to PSP
  async _callPSP(endpoint, data) {
    // In production: HTTP POST to PSP API with TLS, timeouts, retries
    // For demonstration, return a simulated success response
    return { approved: true, success: true, authorizationCode: uuidv4() };
  }
}

// ---------------------------------------------------------------
// Main Payment Service: orchestrates the full payment lifecycle
// ---------------------------------------------------------------

class PaymentService {
  constructor() {
    this.idempotency = new IdempotencyService(redis);
    this.ledger = new LedgerService(db);
    this.fraud = new FraudDetectionService();
    this.psp = new PSPClient();
    this.FRAUD_THRESHOLD = 0.7;       // Block transactions with score >= 0.7
    this.FEE_RATE = 0.029;            // 2.9% processing fee
    this.FEE_FIXED = 0.30;            // $0.30 fixed fee per transaction
  }

  // Calculate the platform fee for a given payment amount.
  // Standard pricing: 2.9% + $0.30 per transaction.
  _calculateFee(amount) {
    return Math.round((amount * this.FEE_RATE + this.FEE_FIXED) * 100) / 100;
  }

  // ---------------------------------------------------------------
  // Process a new payment with full idempotency and state management
  // ---------------------------------------------------------------
  async processPayment(merchantId, idempotencyKey, amount, currency, paymentMethodToken) {
    // STEP 1: Check if this request was already processed (idempotency).
    // This is the cheapest check and handles the common retry case.
    const existingResult = await this.idempotency.getExistingResult(
      merchantId,
      idempotencyKey
    );
    if (existingResult) {
      console.log(`Idempotency hit: returning cached result for key ${idempotencyKey}`);
      return existingResult;
    }

    // STEP 2: Acquire a distributed lock for this idempotency key.
    // Prevents two concurrent requests with the same key from both processing.
    const lockAcquired = await this.idempotency.tryLock(merchantId, idempotencyKey);
    if (!lockAcquired) {
      throw new Error('Concurrent request in progress for this idempotency key');
    }

    try {
      // STEP 3: Create the payment record in CREATED state.
      // This is the first persistent record of the payment intent.
      const paymentId = uuidv4();
      await db.query(
        `INSERT INTO payments
         (id, merchant_id, amount, currency, payment_method_token, state,
          idempotency_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [paymentId, merchantId, amount, currency, paymentMethodToken,
         PaymentState.CREATED, idempotencyKey]
      );

      // STEP 4: Run fraud detection.
      // If the fraud score exceeds the threshold, reject immediately
      // without hitting the PSP (saves processing costs).
      const fraudResult = await this.fraud.evaluate({
        amount,
        currency,
        paymentMethodToken,
        merchantId,
      });

      if (fraudResult.score >= this.FRAUD_THRESHOLD) {
        // Fraud detected: transition to FAILED state
        validateTransition(PaymentState.CREATED, PaymentState.FAILED);
        await this._updatePaymentState(paymentId, PaymentState.FAILED, {
          failure_reason: `Fraud score ${fraudResult.score} exceeds threshold`,
        });

        const result = {
          success: false,
          paymentId,
          state: PaymentState.FAILED,
          reason: 'Payment flagged by fraud detection',
        };
        await this.idempotency.storeResult(merchantId, idempotencyKey, result);
        return result;
      }

      // STEP 5: Authorize with the PSP.
      // This sends the request to the card network via the acquirer.
      const authResponse = await this.psp.authorize({
        id: paymentId,
        amount,
        currency,
        paymentMethodToken,
      });

      if (authResponse.status === 'declined') {
        // Card declined: transition to FAILED state
        validateTransition(PaymentState.CREATED, PaymentState.FAILED);
        await this._updatePaymentState(paymentId, PaymentState.FAILED, {
          failure_reason: authResponse.declineReason,
        });

        const result = {
          success: false,
          paymentId,
          state: PaymentState.FAILED,
          reason: authResponse.declineReason,
        };
        await this.idempotency.storeResult(merchantId, idempotencyKey, result);
        return result;
      }

      if (authResponse.status === 'error') {
        // PSP error (network issue, timeout): transition to FAILED.
        // In production, you would enter AUTHORIZATION_PENDING state
        // and query the PSP for the final status.
        validateTransition(PaymentState.CREATED, PaymentState.FAILED);
        await this._updatePaymentState(paymentId, PaymentState.FAILED, {
          failure_reason: 'PSP communication error',
        });

        const result = {
          success: false,
          paymentId,
          state: PaymentState.FAILED,
          reason: 'Payment processor error. Please retry.',
        };
        await this.idempotency.storeResult(merchantId, idempotencyKey, result);
        return result;
      }

      // STEP 6: Authorization succeeded — update state.
      validateTransition(PaymentState.CREATED, PaymentState.AUTHORIZED);
      await this._updatePaymentState(paymentId, PaymentState.AUTHORIZED, {
        authorization_code: authResponse.authCode,
      });

      // STEP 7: Capture immediately (standard e-commerce auth-capture flow).
      const captureResponse = await this.psp.capture(authResponse.authCode, amount);

      if (captureResponse.status !== 'success') {
        // Capture failed: void the authorization to release the hold.
        await this.psp.void(authResponse.authCode);
        validateTransition(PaymentState.AUTHORIZED, PaymentState.FAILED);
        await this._updatePaymentState(paymentId, PaymentState.FAILED, {
          failure_reason: 'Capture failed after successful authorization',
        });

        const result = {
          success: false,
          paymentId,
          state: PaymentState.FAILED,
          reason: 'Payment capture failed',
        };
        await this.idempotency.storeResult(merchantId, idempotencyKey, result);
        return result;
      }

      // STEP 8: Capture succeeded — update state and record in ledger.
      validateTransition(PaymentState.AUTHORIZED, PaymentState.CAPTURED);
      await this._updatePaymentState(paymentId, PaymentState.CAPTURED);

      // STEP 9: Record double-entry ledger entries.
      // Debit: Platform receivable (money owed from card network)
      // Credit: Merchant balance (net amount after fee)
      // Credit: Platform revenue (the processing fee)
      const fee = this._calculateFee(amount);
      const merchantNet = amount - fee;

      // Fetch account IDs for ledger entries
      const platformReceivableId = await this._getAccountId('PLATFORM_RECEIVABLE', currency);
      const merchantAccountId = await this._getAccountId('MERCHANT', currency, merchantId);
      const platformRevenueId = await this._getAccountId('PLATFORM_REVENUE', currency);

      await this.ledger.recordTransaction(
        uuidv4(),     // Unique transaction ID for the ledger
        paymentId,    // Reference back to the payment
        'CHARGE',     // Transaction type
        [
          {
            accountId: platformReceivableId,
            type: 'DEBIT',
            amount: amount,
            currency: currency,
            description: `Payment ${paymentId} received`,
          },
          {
            accountId: merchantAccountId,
            type: 'CREDIT',
            amount: merchantNet,
            currency: currency,
            description: `Payment ${paymentId} net amount`,
          },
          {
            accountId: platformRevenueId,
            type: 'CREDIT',
            amount: fee,
            currency: currency,
            description: `Fee for payment ${paymentId}`,
          },
        ]
      );

      // STEP 10: Build and cache the success result.
      const result = {
        success: true,
        paymentId,
        state: PaymentState.CAPTURED,
        amount,
        currency,
        fee,
        merchantNet,
        authorizationCode: authResponse.authCode,
      };
      await this.idempotency.storeResult(merchantId, idempotencyKey, result);

      // STEP 11: Send webhook notification to merchant (async, non-blocking).
      // Failure to send a webhook should not fail the payment.
      this._sendWebhookAsync(merchantId, 'payment.captured', result);

      return result;

    } finally {
      // Always release the idempotency lock, even if processing failed.
      await this.idempotency.releaseLock(merchantId, idempotencyKey);
    }
  }

  // ---------------------------------------------------------------
  // Process a refund (full or partial)
  // ---------------------------------------------------------------
  async processRefund(paymentId, refundAmount) {
    // STEP 1: Fetch the payment and validate its current state.
    const paymentResult = await db.query(
      'SELECT * FROM payments WHERE id = $1',
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    const payment = paymentResult.rows[0];

    // Only captured, settled, or partially-refunded payments can be refunded
    const refundableStates = [
      PaymentState.CAPTURED,
      PaymentState.SETTLED,
      PaymentState.PARTIALLY_REFUNDED,
    ];
    if (!refundableStates.includes(payment.state)) {
      throw new Error(
        `Cannot refund payment in ${payment.state} state. ` +
        `Refundable states: ${refundableStates.join(', ')}`
      );
    }

    // STEP 2: Calculate how much has already been refunded.
    const refundedResult = await db.query(
      `SELECT COALESCE(SUM(amount), 0) as total_refunded
       FROM refunds WHERE payment_id = $1 AND status = 'COMPLETED'`,
      [paymentId]
    );
    const totalRefunded = parseFloat(refundedResult.rows[0].total_refunded);
    const remainingRefundable = payment.amount - totalRefunded;

    if (refundAmount > remainingRefundable) {
      throw new Error(
        `Refund amount $${refundAmount} exceeds remaining refundable ` +
        `amount $${remainingRefundable}`
      );
    }

    // STEP 3: Process the refund with the PSP.
    const refundId = uuidv4();
    const pspResponse = await this.psp.refund(
      payment.authorization_code,
      refundAmount
    );

    if (pspResponse.status !== 'success') {
      // Record the failed refund attempt for audit trail
      await db.query(
        `INSERT INTO refunds (id, payment_id, amount, status, failure_reason, created_at)
         VALUES ($1, $2, $3, 'FAILED', $4, NOW())`,
        [refundId, paymentId, refundAmount, pspResponse.error]
      );
      throw new Error(`Refund failed: ${pspResponse.error}`);
    }

    // STEP 4: Record the successful refund.
    await db.query(
      `INSERT INTO refunds (id, payment_id, amount, status, created_at)
       VALUES ($1, $2, $3, 'COMPLETED', NOW())`,
      [refundId, paymentId, refundAmount]
    );

    // STEP 5: Determine the new payment state.
    const newTotalRefunded = totalRefunded + refundAmount;
    const newState = (newTotalRefunded >= payment.amount)
      ? PaymentState.REFUNDED              // Full refund
      : PaymentState.PARTIALLY_REFUNDED;   // Partial refund

    validateTransition(payment.state, newState);
    await this._updatePaymentState(paymentId, newState);

    // STEP 6: Record reversing ledger entries.
    // Refund reverses the original charge: debit merchant, credit receivable.
    const merchantAccountId = await this._getAccountId(
      'MERCHANT', payment.currency, payment.merchant_id
    );
    const platformReceivableId = await this._getAccountId(
      'PLATFORM_RECEIVABLE', payment.currency
    );

    await this.ledger.recordTransaction(
      uuidv4(),
      paymentId,
      'REFUND',
      [
        {
          accountId: merchantAccountId,
          type: 'DEBIT',
          amount: refundAmount,
          currency: payment.currency,
          description: `Refund ${refundId} for payment ${paymentId}`,
        },
        {
          accountId: platformReceivableId,
          type: 'CREDIT',
          amount: refundAmount,
          currency: payment.currency,
          description: `Refund ${refundId} receivable reversal`,
        },
      ]
    );

    // STEP 7: Notify merchant of the refund
    this._sendWebhookAsync(payment.merchant_id, 'payment.refunded', {
      paymentId,
      refundId,
      amount: refundAmount,
      newState,
    });

    return {
      success: true,
      refundId,
      paymentId,
      amount: refundAmount,
      totalRefunded: newTotalRefunded,
      paymentState: newState,
    };
  }

  // ---------------------------------------------------------------
  // Helper: update payment state with optional additional fields
  // ---------------------------------------------------------------
  async _updatePaymentState(paymentId, newState, additionalFields = {}) {
    // Build dynamic SET clause for any additional fields
    const setClauses = ['state = $1', 'updated_at = NOW()'];
    const values = [newState];
    let paramIndex = 2;

    for (const [key, value] of Object.entries(additionalFields)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    values.push(paymentId);
    await db.query(
      `UPDATE payments SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  }

  // ---------------------------------------------------------------
  // Helper: look up account ID by type, currency, and optional owner
  // ---------------------------------------------------------------
  async _getAccountId(accountType, currency, ownerId = null) {
    let query = 'SELECT id FROM accounts WHERE account_type = $1 AND currency = $2';
    const params = [accountType, currency];

    if (ownerId) {
      query += ' AND owner_id = $3';
      params.push(ownerId);
    }

    const result = await db.query(query, params);
    if (result.rows.length === 0) {
      throw new Error(`Account not found: type=${accountType}, currency=${currency}`);
    }
    return result.rows[0].id;
  }

  // ---------------------------------------------------------------
  // Helper: send webhook notification asynchronously
  // ---------------------------------------------------------------
  _sendWebhookAsync(merchantId, eventType, data) {
    // Fire-and-forget: webhook delivery failures are handled by
    // a separate retry mechanism with exponential backoff.
    // We intentionally do not await this — payment success should
    // not depend on webhook delivery.
    setImmediate(async () => {
      try {
        console.log(`Webhook sent: ${eventType} to merchant ${merchantId}`);
        // In production: HTTP POST to merchant's webhook URL with
        // HMAC signature for verification, retry queue for failures
      } catch (error) {
        console.error(`Webhook failed: ${error.message}`);
        // Queue for retry with exponential backoff
      }
    });
  }
}

// ---------------------------------------------------------------
// Database schema (for reference — run this to set up the tables)
// ---------------------------------------------------------------
const SCHEMA_SQL = `
  -- Accounts table: represents entities that hold money
  CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_type VARCHAR(30) NOT NULL,  -- MERCHANT, PLATFORM_RECEIVABLE, etc.
    owner_id UUID,                       -- NULL for platform accounts
    currency CHAR(3) NOT NULL,           -- ISO 4217
    balance DECIMAL(19,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Payments table: core payment records with state machine
  CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY,
    merchant_id UUID NOT NULL,
    amount DECIMAL(19,4) NOT NULL,
    currency CHAR(3) NOT NULL,
    payment_method_token VARCHAR(64) NOT NULL,
    state VARCHAR(30) NOT NULL,
    idempotency_key VARCHAR(64) NOT NULL,
    authorization_code VARCHAR(64),
    failure_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(merchant_id, idempotency_key)  -- Enforce idempotency at DB level
  );

  -- Transactions table: groups related ledger entries
  CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES payments(id),
    type VARCHAR(20) NOT NULL,    -- CHARGE, REFUND, PAYOUT, FEE
    status VARCHAR(20) NOT NULL,  -- PENDING, COMPLETED, FAILED
    amount DECIMAL(19,4) NOT NULL,
    currency CHAR(3) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Ledger entries: the immutable double-entry records
  CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
    amount DECIMAL(19,4) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Refunds table: tracks refund attempts and outcomes
  CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES payments(id),
    amount DECIMAL(19,4) NOT NULL,
    status VARCHAR(20) NOT NULL,   -- COMPLETED, FAILED
    failure_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- Indexes for common query patterns
  CREATE INDEX idx_payments_merchant ON payments(merchant_id);
  CREATE INDEX idx_payments_idempotency ON payments(merchant_id, idempotency_key);
  CREATE INDEX idx_payments_state ON payments(state);
  CREATE INDEX idx_ledger_transaction ON ledger_entries(transaction_id);
  CREATE INDEX idx_ledger_account ON ledger_entries(account_id);
  CREATE INDEX idx_refunds_payment ON refunds(payment_id);
`;

// ---------------------------------------------------------------
// Export for use by API layer
// ---------------------------------------------------------------
module.exports = { PaymentService, PaymentState, SCHEMA_SQL };
```

**Line-by-Line Explanation of Key Design Decisions**

The code above is structured around four core classes, each mapping to a distinct concern. The `IdempotencyService` uses Redis for its speed and atomic `SET NX` operation — checking and claiming an idempotency key must be atomic to prevent two concurrent requests from both passing the check. The 24-hour TTL on cached results balances storage costs against the window in which retries are expected. The `LedgerService` uses a PostgreSQL transaction (`BEGIN`/`COMMIT`) to ensure that all ledger entries for a single payment are written atomically — either all entries are persisted or none are, which is the foundation of double-entry integrity. The balance validation (debits must equal credits) is a defense-in-depth check: the business logic should always produce balanced entries, but the ledger service verifies this as a precondition before writing. The `PaymentService.processPayment` method follows a strict ordering: idempotency check first (cheapest), then fraud detection (avoids PSP costs for bad transactions), then authorization, then capture, then ledger recording. Each step that can fail has explicit error handling that transitions the payment to the appropriate state and caches the failure result for idempotency. The webhook is sent asynchronously via `setImmediate` because payment success must not depend on webhook delivery — a merchant's webhook endpoint being down should never block or fail a payment.

---

### Section 12 — Connection to Next Topic

A payment system is, at its core, about moving money reliably. But in the real world, payments rarely happen in isolation — they are part of a larger transaction that involves reserving a scarce resource, confirming availability, and completing a purchase. This is the bridge to Topic 54: Design a Ticket Booking System.

A ticket booking system (think Ticketmaster, BookMyShow, or airline reservation systems) introduces a new dimension of complexity on top of payment processing: inventory management with temporal holds. When a customer selects a seat at a concert, the system must temporarily hold that seat (preventing other customers from booking it) while the customer completes payment. This creates a hold-reserve-purchase lifecycle that mirrors — and extends — the authorize-capture-settle lifecycle of payments. The seat hold is analogous to a payment authorization: it reserves a resource for a limited time. If the customer completes payment within the hold window, the reservation is confirmed (analogous to capture). If the hold expires, the seat is released back to inventory (analogous to voiding an authorization).

The design challenges multiply when you combine inventory and payments. What happens if the payment fails after the seat is held? The seat must be released immediately — but the release must be reliable even if the payment service crashes. What happens if two customers try to book the last remaining seat simultaneously? The system needs a concurrency control mechanism (optimistic locking, distributed locks, or a serializable queue) to ensure exactly one customer gets the seat. What happens during a flash sale when 100,000 users try to buy 1,000 tickets in the first ten seconds? The system must handle extreme write contention on a small set of inventory rows without degrading to a crawl.

Topic 54 will explore these challenges in depth, building on the payment processing foundations you have learned here. The saga pattern from Section 8 will reappear as the orchestration mechanism for the book-pay-confirm workflow. The idempotency patterns from Section 5 will prevent duplicate bookings. And the double-entry ledger from Section 6 will track not just money, but inventory movements — ensuring that tickets, like dollars, never appear or disappear. The transition from "how do we move money safely" to "how do we sell scarce resources with payment" is a natural progression, and the next topic will test your ability to combine these concerns into a cohesive design.

---

<!--
Topic: 54
Title: Design a Ticket Booking System (Ticketmaster)
Section: 11 — Real-World Designs Part 3
Track: 0-to-100 Deep Mastery
Difficulty: mid-senior
Interview Weight: medium
Prerequisites: Topics 1-3, 6, 10, 18, 23, 31
Next Topic: Topic 55 (Design a Metrics and Monitoring System)
Date: 2026-02-25
-->

## Topic 54: Design a Ticket Booking System (Ticketmaster)

---

### Section 1 — Why This Design?

In 1976, two programmers in Phoenix, Arizona — Albert Leffler and Peter Gadwa — built one of the earliest computerized ticketing systems. They called it Ticketmaster. At the time, the problem seemed straightforward: maintain an inventory of seats, let people buy them, and make sure no two people end up with the same seat. That simplicity was deceptive. Over the next five decades, ticket booking would evolve into one of the most technically demanding problems in distributed systems engineering, combining extreme concurrency, adversarial traffic, fairness constraints, and brutal latency requirements into a single product.

The breaking point arrived spectacularly in November 2022, when Ticketmaster attempted to sell tickets for Taylor Swift's Eras Tour. The presale event attracted an estimated 14 million users attempting to access the platform simultaneously — roughly four times the expected load. The virtual queue collapsed. Users who had waited hours were dropped. Tickets appeared available and then vanished mid-checkout. The system experienced cascading failures across its booking pipeline, payment integration, and seat inventory services. Ticketmaster's parent company, Live Nation, was hauled before the United States Senate Judiciary Committee. The incident became a case study not in music fandom but in distributed systems failure modes: thundering herd problems, insufficient backpressure, double-booking race conditions, and the fragility of systems designed for average load rather than peak load.

This design problem is a favorite in system design interviews because it forces candidates to grapple with several intersecting hard problems simultaneously. First, there is the concurrency control challenge: millions of users competing for a finite, non-fungible inventory (specific seats in a specific venue) where double-selling is unacceptable. Second, there is the traffic spike problem: a ticket booking system must handle load that can surge by 1000x within seconds of a sale opening. Third, there is the fairness problem: how do you ensure that real humans get tickets ahead of bots, and that the queuing mechanism itself does not introduce unfairness? Fourth, there is the distributed locking problem: how do you temporarily reserve a seat for one user during checkout without blocking the entire system? These challenges test your understanding of distributed locking (Topic 18), caching and read-path optimization (Topic 6), database design and indexing (Topic 10), queue-based architectures (Topic 23), and rate limiting (Topic 31). A candidate who can navigate this design demonstrates mastery of real-world concurrency under adversarial conditions.

---

### Section 2 — Requirements Gathering

**Functional Requirements**

The system must support the complete lifecycle of a ticket purchase. Users need to browse an event catalog — searching by artist, venue, city, date, or genre. When a user selects an event, they must see the venue's seat map with real-time (or near-real-time) availability. The user selects one or more seats, which triggers a temporary hold — the seats are reserved exclusively for that user for a limited window (typically 8-12 minutes) while they complete checkout. During checkout, the system integrates with a payment processor (Stripe, PayPal, etc.) to charge the user. Upon successful payment, the system confirms the booking, generates an e-ticket (with a QR code or barcode), and delivers it via email and/or push notification. The system must also support a virtual waiting room for high-demand events, where users are queued before being admitted to the seat selection flow. Administrative functions include event creation, venue and seat map configuration, pricing tier management, and sales analytics.

Additional functional requirements include: order history for users, ticket transfers between users, refund processing, waitlist management for sold-out events, and an anti-bot verification layer. The system should support multiple ticket types per event (general admission, VIP, reserved seating, accessible seating) and dynamic pricing based on demand.

**Non-Functional Requirements**

The system must handle massive traffic spikes. For a popular event on-sale, the system should support up to 10 million concurrent users in the waiting room and process at least 10,000 seat reservations per second at peak. Seat selection response time must remain under 5 seconds even under peak load. The double-booking rate must be exactly zero — this is a hard correctness requirement, not a soft target. The system should target 99.95% availability during active sales (roughly 22 minutes of downtime per month, none of which should occur during a sale window). The virtual queue must provide fairness guarantees: users who arrive earlier should generally be served earlier, though some lottery-based randomization is acceptable if disclosed. E-ticket delivery should complete within 60 seconds of payment confirmation. The system must resist bot traffic — at least 90% of automated purchase attempts should be blocked.

**Back-of-Envelope Estimation**

Let us size the system for a platform handling 1,000 events per day with an average venue capacity of 50,000 seats.

Daily ticket inventory: 1,000 events x 50,000 seats = 50 million seat records created per day. If each seat record is approximately 200 bytes (event_id, section, row, seat number, status, price, hold_expiry, booking_id), the daily seat data volume is 50M x 200B = 10 GB/day, or roughly 3.6 TB/year before considering indexes and replication.

For a normal event, assume 100,000 users attempt to buy 50,000 seats over a 2-hour sale window. That is roughly 14 seat-selection requests per second — trivial for any modern database.

For a blockbuster event (Taylor Swift, BTS, World Cup Final), assume 10 million users arrive within the first 5 minutes. The waiting room must absorb 10M / 300s = 33,333 new connections per second. If the system admits users at a controlled rate of 5,000 per second into the seat selection flow, and each user takes an average of 3 minutes to browse and select seats, the peak concurrent users in the booking pipeline is 5,000/s x 180s = 900,000 active sessions. Each session generates roughly 5 read queries (seat map, availability checks, section drill-downs) and 1-2 write queries (hold, confirm/release), yielding peak read QPS of 4.5 million and peak write QPS of ~10,000. The read path must be heavily cached.

Storage for the queue itself: if we store a 64-byte record per queued user (user_id, position, timestamp, token), 10M users = 640 MB — easily fits in memory.

Payment processing: at 10,000 reservations per second with a 70% checkout completion rate, we need ~7,000 payment transactions per second. This is the bottleneck — payment gateways like Stripe typically support 1,000-5,000 TPS per merchant account, so we may need multiple merchant accounts or payment gateway sharding.

Network bandwidth: if the seat map payload is 50 KB (compressed JSON with seat coordinates and availability), serving it to 900,000 concurrent users with a 30-second refresh interval means 900,000 / 30 x 50KB = 1.5 GB/s outbound. A CDN is mandatory.

---

### Section 3 — High-Level Architecture

The system decomposes into seven primary services, each responsible for a distinct domain. The **Event Catalog Service** manages the read-heavy browsing experience — event listings, search, venue information, and artist metadata. The **Seat Inventory Service** owns the source of truth for seat availability and handles the critical write path of holds and reservations. The **Booking Service** orchestrates the end-to-end purchase flow: coordinating between seat inventory, payment, and ticket generation. The **Payment Service** integrates with external payment gateways and handles charge, refund, and webhook processing. The **Queue / Waiting Room Service** manages the virtual queue for high-demand events, controlling admission rate and providing position updates. The **Notification Service** handles email, SMS, and push notification delivery for ticket confirmations, reminders, and waitlist alerts. The **Anti-Bot Service** sits at the edge, performing CAPTCHA challenges, device fingerprinting, behavioral analysis, and rate limiting before users even reach the queue.

```
                                   +------------------+
                                   |   CDN / Edge     |
                                   | (Static Assets,  |
                                   |  Seat Map Cache) |
                                   +--------+---------+
                                            |
                                   +--------v---------+
                                   |  Anti-Bot Layer   |
                                   | (CAPTCHA, Rate    |
                                   |  Limit, Fingerprint)|
                                   +--------+---------+
                                            |
                              +-------------v--------------+
                              |      API Gateway /         |
                              |      Load Balancer         |
                              +--+------+------+-------+---+
                                 |      |      |       |
                    +------------+  +---+---+  |  +----+----------+
                    |               |       |  |  |               |
          +---------v--------+ +---v----+  |  |  +--v----------+ |
          | Event Catalog    | | Queue/ |  |  |  | Notification| |
          | Service          | |Waiting |  |  |  | Service     | |
          | (Browse, Search) | | Room   |  |  |  | (Email,SMS) | |
          +---------+--------+ +---+----+  |  |  +-------------+ |
                    |              |        |  |                  |
                    |    +---------+   +---v--v-------+          |
                    |    |             | Booking       |          |
                    |    | Controlled  | Service       |          |
                    |    | Admission   | (Orchestrator)|          |
                    |    |             +---+-------+---+          |
                    |    |                 |       |              |
               +----v----v----+    +-------v--+ +--v-----------+ |
               | Seat         |    | Payment  | | Ticket       | |
               | Inventory    |    | Service  | | Generation   | |
               | Service      |    | (Stripe, | | Service      | |
               | (Hold/Reserve|    |  PayPal) | | (QR/Barcode) | |
               | /Release)    |    +----------+ +--------------+ |
               +------+-------+                                  |
                      |                                          |
            +---------v----------+          +--------------------+
            | Primary DB (SQL)   |          |
            | Seat Inventory     |          |
            | (Row-Level Locks)  |          |
            +----+----------+----+          |
                 |          |               |
            +----v---+ +----v---+    +------v-------+
            |Read    | |Read    |    | Event DB     |
            |Replica | |Replica |    | (Catalog,    |
            |  #1    | |  #2    |    |  Venues)     |
            +--------+ +--------+    +--------------+
```

The architecture separates the read path (event browsing, seat map viewing) from the write path (seat holds, bookings, payments). The read path is served by the Event Catalog Service backed by read replicas and a CDN layer for static assets. The write path flows through the Queue Service into the Booking Service, which coordinates with the Seat Inventory Service and Payment Service. This separation is critical: during a flash sale, the write path experiences extreme contention, but the read path must remain responsive for millions of users checking availability.

Communication between services uses a mix of synchronous REST/gRPC calls (for the booking flow, where the user is waiting) and asynchronous message queues (for notification delivery, analytics events, and ticket generation). The Booking Service acts as the orchestrator, implementing a saga pattern to coordinate the multi-step booking transaction across seat inventory and payment services, with compensating transactions (releasing held seats) if any step fails.

---

### Section 4 — Deep Dive: Seat Inventory and Concurrency

The single hardest problem in ticket booking system design is preventing double-booking while maintaining acceptable performance under extreme concurrency. When 100,000 users simultaneously attempt to select the same seat in section A, row 5, seat 12, exactly one of them must succeed, and the other 99,999 must be informed immediately that the seat is no longer available. This is the classic write-write conflict problem in distributed systems, and it has no easy solution.

**The Double-Booking Problem**

Consider a naive implementation: User A reads seat status as "available," User B reads seat status as "available" (both reads happen before either write), User A writes status to "held," User B writes status to "held." Both users now believe they have the seat. This is a textbook lost-update anomaly, and it is the exact failure mode that causes real-world double-booking incidents.

**Pessimistic Locking**

The most straightforward solution is pessimistic locking — acquire an exclusive lock on the seat row before reading its status. In SQL, this is `SELECT ... FOR UPDATE`. When User A executes `SELECT status FROM seats WHERE event_id = ? AND seat_id = ? FOR UPDATE`, the database acquires a row-level exclusive lock. User B's identical query blocks until User A's transaction commits or rolls back. This guarantees correctness but introduces contention: if thousands of users target the same seat, they serialize on the lock, and most will time out. For a system where users select specific seats, this is acceptable because the lock granularity is a single seat — contention only occurs when multiple users want the exact same seat. However, for general admission events where any available seat is acceptable, a query like `SELECT * FROM seats WHERE event_id = ? AND status = 'available' LIMIT 1 FOR UPDATE` can create a hot-row problem where every user contends for the same row.

**Optimistic Locking**

An alternative is optimistic locking using a version column. Each seat row has a `version` field. The application reads the seat with its version, performs business logic, and then issues `UPDATE seats SET status = 'held', version = version + 1 WHERE seat_id = ? AND version = ?`. If another transaction modified the seat between the read and write, the WHERE clause matches zero rows, and the application retries or informs the user. Optimistic locking avoids blocking but increases retry storms under high contention. It works well when conflicts are rare (most users select different seats) but degrades when conflicts are common (everyone wants front-row center).

**Distributed Locks with Redis**

For systems that cannot rely on a single database for all locking (e.g., sharded databases, microservice architectures), distributed locks provide an alternative. A Redis-based lock uses `SET seat:{event_id}:{seat_id} {user_id} NX EX 600` — this atomically sets a key only if it does not exist (`NX`) with a 600-second TTL (`EX 600`). If the SET succeeds, the user has the lock (and thus the seat hold). If it fails, another user holds the seat. Redis's single-threaded command execution guarantees atomicity. For stronger guarantees across Redis cluster failures, the Redlock algorithm uses multiple independent Redis instances and requires a majority quorum, though this approach has been debated extensively (Martin Kleppmann's critique vs. Salvatore Sanfilippo's rebuttal).

**Temporary Hold with TTL**

Regardless of the locking mechanism, the system must implement a temporary hold. When a user selects a seat, the seat transitions from "available" to "held" with a TTL (typically 8-12 minutes). During this window, the user completes checkout. If the TTL expires without a successful payment, the seat automatically returns to "available." This is implemented either via a database column (`hold_expires_at TIMESTAMP`) with a background sweeper process that releases expired holds, or via Redis key expiration if using distributed locks. The hold duration is a critical tuning parameter: too short, and users cannot complete checkout; too long, and popular seats are locked up by users who have abandoned the flow.

**Seat Map Representation**

The venue's seat map is represented as a hierarchical structure: Venue -> Sections -> Rows -> Seats. Each seat has a coordinate (for rendering on the interactive map), a pricing tier, and an availability status. For efficient querying, the seat inventory is indexed by `(event_id, section_id, status)` to support queries like "show me all available seats in Section 101." The seat map itself (coordinates, section boundaries, visual layout) is static per venue and cached aggressively — it changes only when the venue is reconfigured. The dynamic part (availability) is overlaid at query time, fetched from the seat inventory service.

For rendering performance, the system pre-computes availability summaries at the section level: "Section 101: 342 of 500 available, price range $75-$150." This allows the initial seat map view to load from cache without querying individual seat records. Only when the user zooms into a specific section does the system fetch per-seat availability, reducing read load by an order of magnitude.

---

### Section 5 — Virtual Queue / Waiting Room

The virtual waiting room is arguably the most important component in a modern ticket booking system, and its absence was a primary cause of the Ticketmaster Eras Tour disaster. Without a waiting room, a flash sale event causes a thundering herd: millions of users simultaneously hit the seat selection and booking services, overwhelming databases, exhausting connection pools, and causing cascading failures. The waiting room acts as a controlled valve — it absorbs the initial traffic surge into a holding area, then admits users to the booking flow at a sustainable rate.

**Why a Waiting Room Is Necessary**

Consider the math from our earlier estimation: a popular event attracts 10 million users in the first 5 minutes. Without a queue, all 10 million users hit the seat selection API simultaneously. Even if each request takes only 50ms, 10M requests at 50ms each require 500,000 seconds of compute — roughly 2,800 server-hours, all demanded in a 5-minute window. No auto-scaling system can spin up thousands of servers in seconds. The waiting room converts an uncontrollable spike into a controlled, steady stream. If we admit 5,000 users per second, and the venue has 50,000 seats, the sale completes in roughly 10 seconds of admission time (most users buy 1-4 tickets). In practice, the sale extends over 15-30 minutes because users take time to browse, select, and complete checkout.

**Queue Implementation**

The queue works as follows. When a user navigates to the event page during a high-demand sale, instead of seeing the seat map, they are redirected to the waiting room. The system assigns them a position token — a cryptographically signed JWT containing their user ID, join timestamp, assigned position, and the event ID. The position can be assigned via FIFO (first-come-first-served based on join time) or via a randomized lottery (all users who join within the first N minutes are randomly shuffled). The user's browser polls a lightweight status endpoint every 5-10 seconds: `GET /queue/status?token={jwt}` returns their current position, estimated wait time, and whether they have been admitted.

The admission controller is a separate process that maintains a counter of currently active users in the booking flow. When a user completes checkout (success or abandonment) or their session expires, the counter decrements. The controller admits new users from the queue to maintain the target concurrency level (e.g., 50,000 active booking sessions). Admission is signaled by updating the user's queue status and providing a short-lived admission token that grants access to the seat selection API.

**Fairness Guarantees**

Fairness is both a technical and a business problem. Pure FIFO ordering rewards users with faster internet connections and lower latency to the server — users in rural areas or developing countries are systematically disadvantaged. Lottery-based assignment within time windows is more equitable: all users who join within the first 2 minutes are randomly shuffled, giving everyone in that window an equal chance regardless of their exact arrival time. Ticketmaster's SmartQueue uses a hybrid approach: a verified fan presale (where fans register interest days in advance and are randomly selected for early access) followed by a FIFO general sale.

**Queue Position Estimation**

Providing accurate wait time estimates is important for user experience but surprisingly difficult. The estimation depends on: (1) the user's position in the queue, (2) the admission rate, (3) the average time users spend in the booking flow, and (4) the rate at which seats sell out. A simple estimate is `wait_time = position / admission_rate`, but this breaks down as the event approaches sellout (admission rate drops because there are fewer seats to show). A more sophisticated model tracks the rolling average of booking completion times and adjusts dynamically.

**Technical Implementation**

Cloudflare's Waiting Room product handles the queue at the edge — the user never reaches the origin server until admitted. This is ideal because it offloads traffic management to the CDN layer, which is designed to handle millions of connections. For a custom implementation, the queue service is a lightweight, horizontally scalable application backed by Redis sorted sets (ZADD for insertion with score = position, ZRANGEBYSCORE for admission batch selection). The queue service itself must be resilient to failure — if it goes down, the system should fail closed (no new admissions) rather than fail open (bypass the queue and overwhelm the backend).

---

### Section 6 — Database Design

The database schema must balance read performance (millions of users browsing events and seat maps), write correctness (zero double-bookings), and operational simplicity (manageable sharding and replication).

**Core Tables**

```
-- Events: the catalog of bookable events
CREATE TABLE events (
    event_id        BIGINT PRIMARY KEY,
    artist_name     VARCHAR(255) NOT NULL,
    venue_id        BIGINT NOT NULL REFERENCES venues(venue_id),
    event_date      TIMESTAMP NOT NULL,
    sale_start      TIMESTAMP NOT NULL,
    sale_end        TIMESTAMP,
    status          ENUM('scheduled','on_sale','sold_out','cancelled') DEFAULT 'scheduled',
    total_seats     INT NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW(),
    INDEX idx_event_date (event_date),
    INDEX idx_status (status),
    INDEX idx_artist (artist_name)
);

-- Venues: physical venue layout metadata
CREATE TABLE venues (
    venue_id        BIGINT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    city            VARCHAR(100),
    state           VARCHAR(50),
    country         VARCHAR(50),
    total_capacity  INT NOT NULL,
    seat_map_json   JSON  -- static seat map layout (coordinates, sections)
);

-- Seat inventory: the critical table — one row per seat per event
CREATE TABLE seat_inventory (
    seat_id         BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id        BIGINT NOT NULL REFERENCES events(event_id),
    section         VARCHAR(20) NOT NULL,
    row_name        VARCHAR(10) NOT NULL,
    seat_number     INT NOT NULL,
    price_cents     INT NOT NULL,
    status          ENUM('available','held','sold') DEFAULT 'available',
    held_by         BIGINT REFERENCES users(user_id),
    hold_expires_at TIMESTAMP NULL,
    booking_id      BIGINT REFERENCES bookings(booking_id),
    version         INT DEFAULT 0,  -- for optimistic locking
    UNIQUE INDEX idx_event_seat (event_id, section, row_name, seat_number),
    INDEX idx_event_status (event_id, status),
    INDEX idx_hold_expiry (hold_expires_at) -- for sweeper queries
);

-- Bookings: completed purchase records
CREATE TABLE bookings (
    booking_id      BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL REFERENCES users(user_id),
    event_id        BIGINT NOT NULL REFERENCES events(event_id),
    total_cents     INT NOT NULL,
    payment_id      VARCHAR(255),  -- external payment gateway reference
    status          ENUM('pending','confirmed','refunded','cancelled') DEFAULT 'pending',
    created_at      TIMESTAMP DEFAULT NOW(),
    confirmed_at    TIMESTAMP NULL,
    INDEX idx_user_bookings (user_id, created_at),
    INDEX idx_event_bookings (event_id)
);

-- Booking items: individual seats within a booking
CREATE TABLE booking_items (
    item_id         BIGINT PRIMARY KEY AUTO_INCREMENT,
    booking_id      BIGINT NOT NULL REFERENCES bookings(booking_id),
    seat_id         BIGINT NOT NULL REFERENCES seat_inventory(seat_id),
    price_cents     INT NOT NULL
);

-- Users: registered platform users
CREATE TABLE users (
    user_id         BIGINT PRIMARY KEY AUTO_INCREMENT,
    email           VARCHAR(255) UNIQUE NOT NULL,
    name            VARCHAR(255),
    phone           VARCHAR(20),
    is_verified_fan BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Waitlist: for sold-out events
CREATE TABLE waitlist (
    waitlist_id     BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id        BIGINT NOT NULL REFERENCES events(event_id),
    user_id         BIGINT NOT NULL REFERENCES users(user_id),
    position        INT NOT NULL,
    status          ENUM('waiting','notified','expired') DEFAULT 'waiting',
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE INDEX idx_event_user (event_id, user_id),
    INDEX idx_event_position (event_id, position)
);
```

**Why SQL with Row-Level Locking**

The seat inventory table is the most critical table in the system, and it demands strong consistency guarantees. A NoSQL database would offer better horizontal scalability but at the cost of weaker consistency models — exactly the wrong trade-off for a system where double-booking is unacceptable. Relational databases like PostgreSQL and MySQL provide ACID transactions with row-level locking, which is precisely what we need for the `SELECT ... FOR UPDATE` pattern on individual seat rows. The UNIQUE constraint on `(event_id, section, row_name, seat_number)` provides an additional safety net against duplicate seat records.

The event catalog and user tables, which are read-heavy and do not require the same level of write consistency, can be backed by a separate database optimized for read performance, or even by a search engine like Elasticsearch for full-text search over event names, artists, and venues.

**Sharding Strategy**

The seat inventory is naturally shardable by `event_id`. Each event's seats are independent of every other event's seats — there are no cross-event transactions. Sharding by event_id ensures that all seats for a given event reside on the same shard, allowing single-shard transactions for seat holds and bookings. This is critical because distributed transactions across shards would introduce coordination overhead and reduce throughput at exactly the moment we need maximum performance (during a flash sale).

For a system handling 1,000 events per day, with each event's seat data being roughly 10 MB (50,000 seats x 200 bytes), a single shard can comfortably hold months of events. We can use range-based or hash-based sharding: range-based (event_id ranges) allows easy archival of old events, while hash-based (hash(event_id) % N) provides more uniform distribution. A practical approach is consistent hashing with virtual nodes, allowing dynamic shard addition as the platform grows.

The hold expiry sweeper runs per-shard: every 30 seconds, it executes `UPDATE seat_inventory SET status = 'available', held_by = NULL, hold_expires_at = NULL WHERE status = 'held' AND hold_expires_at < NOW()`. This query is efficient because of the `idx_hold_expiry` index and only touches rows on the local shard.

---

### Section 7 — Handling Traffic Spikes

A ticket booking system's defining operational challenge is the extreme variance between its baseline load and its peak load. On a normal day, the system processes a few hundred transactions per second. During a major on-sale event, that number can spike to tens of thousands. The system must handle both without over-provisioning (wasteful) or under-provisioning (catastrophic). This section covers the layered approach to managing these spikes.

**CDN for Static Content**

The vast majority of traffic during a flash sale is read traffic: users loading the event page, viewing the venue map, checking prices, and refreshing seat availability. The event page (HTML, CSS, JavaScript), venue map images, and artist photos are entirely static and must be served from a CDN (CloudFront, Cloudflare, Akamai). With proper cache headers, the CDN absorbs over 90% of read traffic without it ever reaching the origin servers. The seat map layout (section coordinates, row labels, price tiers) is also static per venue and cacheable. Only the availability overlay (which seats are available/held/sold) is dynamic.

**Read Replicas for Browsing**

For the dynamic availability data, read replicas provide horizontal read scaling. The event catalog service reads from replicas, accepting a small replication lag (typically under 1 second). This means a user might see a seat as "available" that was held 500ms ago — this is acceptable because the actual hold is enforced at the write path (the `SELECT ... FOR UPDATE` on the primary). Showing slightly stale availability is a conscious trade-off: the alternative (reading from the primary for every availability check) would overwhelm the primary database under flash sale load.

**Write Path Isolation**

The write path (seat holds, bookings, payment processing) must be isolated from the read path. This means separate database connection pools, separate application server clusters, and separate load balancers for read and write operations. During a flash sale, the write path is the bottleneck, and we cannot allow read traffic to consume write path resources. Connection pool exhaustion on the primary database is a common failure mode — if browsing queries consume all available connections, booking transactions cannot proceed. Isolation prevents this.

**Auto-Scaling**

The waiting room service and the API gateway layer should auto-scale based on connection count and request rate. Cloud providers offer auto-scaling groups that can add instances within 60-90 seconds of a scaling trigger. However, database connections cannot scale as easily — each new application instance opens a pool of connections to the database, and databases have hard limits on connection count. A connection pooler like PgBouncer (for PostgreSQL) or ProxySQL (for MySQL) sits between application instances and the database, multiplexing many application connections over fewer database connections.

**Circuit Breakers**

When the payment service or an external dependency becomes slow or unresponsive, the circuit breaker pattern prevents cascading failures. If the payment service latency exceeds a threshold (e.g., 5 seconds) or error rate exceeds 50%, the circuit opens and the booking service immediately returns a "try again later" response instead of holding database locks and threads while waiting for a timeout. This preserves system resources for users whose transactions can succeed.

**Graceful Degradation**

When the system is under extreme load, it should degrade gracefully rather than fail completely. Specific degradation strategies include: showing approximate seat availability instead of exact counts ("limited seats available" instead of "347 seats available"), disabling the interactive seat map and offering "best available" auto-assignment instead, reducing the hold TTL from 10 minutes to 5 minutes to increase seat turnover, and temporarily disabling non-essential features like order history and account settings. Each degradation level is triggered by specific load thresholds and can be activated manually by operations or automatically by monitoring alerts.

---

### Section 8 — Bot Prevention and Fairness

The ticket resale market is a multi-billion-dollar industry, and automated bots are the primary tool of professional scalpers. During a major on-sale event, bot traffic can constitute 60-90% of total traffic. Bots are faster, more numerous, and more persistent than human users, and without countermeasures, they will purchase the majority of tickets within seconds of a sale opening. Bot prevention is not just a technical problem — it is a fairness problem with regulatory and reputational consequences.

**CAPTCHA**

CAPTCHA (Completely Automated Public Turing test to tell Computers and Humans Apart) is the first line of defense. Modern CAPTCHAs like reCAPTCHA v3 and hCaptcha assign a risk score based on behavioral signals (mouse movements, scroll patterns, keystroke timing) without requiring explicit user interaction. Users with low risk scores pass through silently; users with high risk scores are presented with a visual challenge. The challenge with CAPTCHA is the arms race: sophisticated bots use CAPTCHA-solving services (both AI-based and human farms) that can solve challenges at scale. CAPTCHA should be one layer in a defense-in-depth strategy, not the sole protection.

**Device Fingerprinting**

Device fingerprinting collects browser and device attributes (screen resolution, installed fonts, WebGL renderer, timezone, language, browser plugins, audio context hash) to create a unique identifier for each device. If multiple "users" share the same device fingerprint, they are likely the same person (or bot) using multiple accounts. Fingerprinting is also useful for detecting headless browsers (Puppeteer, Selenium) that bots commonly use — headless browsers have distinct fingerprint characteristics (missing plugins, default screen resolution, specific WebGL signatures).

**Behavioral Analysis**

Real humans exhibit characteristic behavioral patterns: variable mouse movement speed, natural scroll patterns, reading pauses, hesitation before clicking. Bots exhibit machine-like precision: instant page loads followed by immediate clicks, perfectly straight mouse paths, zero reading time. A behavioral analysis engine collects these signals during the waiting room phase and assigns a "humanity score." Users below the threshold are challenged or blocked. This analysis can be performed client-side (JavaScript collecting events) and server-side (analyzing request timing patterns).

**IP Rate Limiting**

Basic rate limiting restricts the number of requests per IP address per time window. More sophisticated approaches use sliding windows, token buckets, and IP reputation databases. However, IP-based limiting has significant limitations: bots use rotating proxy networks with thousands of IP addresses, while legitimate users behind corporate NATs or university networks share a single IP. Rate limiting should use compound keys (IP + device fingerprint + user ID) rather than IP alone.

**Proof-of-Work Challenges**

An emerging approach borrows from cryptocurrency: require the client to solve a computational puzzle (e.g., find a partial hash collision) before submitting a booking request. The puzzle difficulty is calibrated so that a browser tab solves it in 2-5 seconds, but a bot operating thousands of concurrent sessions would need proportionally more compute. This approach is effective against volume-based bot attacks but does not stop well-funded adversaries with GPU farms.

**Verified Fan Programs**

Ticketmaster's Verified Fan program takes a different approach entirely. Fans register interest in an event days or weeks before the sale. Ticketmaster analyzes registration data (account age, purchase history, listening data from Spotify integration, social media activity) to identify genuine fans. A subset of verified fans receives a unique access code for the presale. This approach is highly effective because it shifts bot detection from the time-pressured on-sale moment to a days-long verification window, and it limits the attack surface to the smaller presale cohort.

**Queue Randomization vs. FIFO Debate**

A pure FIFO queue rewards speed — whoever arrives first gets the best position. This favors bots (which can submit queue entry requests within milliseconds of the sale opening) and users with low-latency internet connections. Randomized queue assignment within a time window (e.g., all users who join within the first 2 minutes are shuffled randomly) is more equitable but feels less fair to users who "got there first." The optimal approach depends on the event and the audience. A hybrid model — small FIFO advantage for earlier arrivals, with significant randomization — balances speed incentive with fairness.

**Resale and Scalping Prevention**

Technical measures to prevent resale include: non-transferable tickets tied to a verified identity (requiring ID at the door), dynamic QR codes that refresh periodically (preventing screenshot sharing), delayed ticket delivery (tickets released only 24-48 hours before the event, reducing the resale window), and price caps on the official resale marketplace. Some jurisdictions have enacted anti-scalping legislation, making technical enforcement mechanisms legally required.

---

### Section 9 — Trade-Offs and Design Decisions

Every system design interview evaluates a candidate's ability to articulate trade-offs — not just what they chose, but what they gave up, why, and under what conditions they might choose differently. This section catalogs the key decision points in a ticket booking system.

**Optimistic vs. Pessimistic Locking**

Pessimistic locking (SELECT FOR UPDATE) guarantees correctness but introduces contention. Under low concurrency (most events), it works flawlessly. Under extreme concurrency (blockbuster events), it causes lock wait timeouts and connection pool exhaustion. Optimistic locking (version-based CAS) avoids blocking but generates retry storms when many users target the same seat. The practical choice is pessimistic locking at the database level (because correctness is non-negotiable) combined with a virtual queue that limits the number of concurrent users reaching the database (because the queue controls the concurrency level). The queue makes pessimistic locking feasible even for high-demand events by ensuring that the database never sees more than a few thousand concurrent transactions.

**Seat Hold Duration**

A longer hold (15 minutes) gives users time to complete checkout but reduces seat turnover — if a user abandons checkout, the seat is unavailable for 15 minutes. A shorter hold (5 minutes) increases turnover but creates checkout pressure that leads to user frustration and payment errors. The optimal duration depends on the payment flow complexity. If the system supports stored payment methods (one-click checkout), a 5-minute hold is sufficient. If users must enter payment details manually, 10 minutes is more appropriate. Dynamic hold duration based on system load (shorter holds during peak to increase throughput) is an advanced optimization.

**Queue Fairness: FIFO vs. Lottery**

FIFO is perceived as fair ("I waited longer, I should go first") but is gameable (bots arrive first) and geographically biased (users closer to servers arrive first). Lottery is more equitable but feels arbitrary ("I arrived at 10:00:00 and someone who arrived at 10:01:59 got in before me"). The compromise is batched FIFO with small randomization: users are admitted in batches (e.g., 1000 users per batch), within each batch the order is randomized, but earlier batches are always admitted before later batches.

**Real-Time vs. Approximate Seat Availability**

Real-time availability requires reading from the primary database for every seat map request, which is unsustainable under flash sale load. Approximate availability reads from a cache or read replica with a 1-5 second staleness window. The user might see a seat as available that is actually held — but the hold is enforced at booking time, and the user is gracefully informed. Approximate availability is the correct choice for the browsing phase; real-time is only needed at the moment of seat selection (the write path).

**Centralized vs. Distributed Seat Inventory**

A centralized inventory (single primary database per event) simplifies locking and consistency but creates a single point of failure and a throughput ceiling. A distributed inventory (seats partitioned across multiple nodes) increases throughput but requires distributed coordination for cross-partition operations. Since events are independent (no cross-event transactions), the practical approach is event-level sharding: each event's inventory lives on a single node (centralized per event), but different events are spread across nodes (distributed across events). This gives us the consistency of centralized locking with the scalability of distributed data.

**Pre-Assigned vs. Choose-Your-Seat**

In a choose-your-seat model, users browse an interactive seat map and select specific seats. This is the premium experience but creates hot-seat contention (everyone wants front-row center) and requires a heavier UI. In a pre-assigned (or "best available") model, users specify a section and quantity, and the system assigns the best available seats. This dramatically reduces contention (the system can assign non-overlapping seats to concurrent users) and simplifies the UI. Most systems offer both: choose-your-seat for reserved-seating venues and best-available for general admission and high-demand events where the interactive map would be overwhelmed.

---

### Section 10 — Interview Questions

**Beginner Tier**

**Q1: How would you prevent two users from booking the same seat?**

Model Answer: The core mechanism is database-level locking on the seat record. When a user selects a seat, the system executes a `SELECT ... FOR UPDATE` query within a transaction, which acquires an exclusive row-level lock on that seat's record. The application checks the seat's status — if it is "available," it updates the status to "held" and sets a hold expiry timestamp. If the status is already "held" or "sold," the application informs the user that the seat is no longer available. The transaction then commits, releasing the lock. Because the lock is held for the duration of the transaction (which should be kept as short as possible — just the status check and update, not the entire checkout flow), only one user can modify the seat at a time. The hold has a TTL (e.g., 10 minutes); if the user does not complete checkout within this window, a background sweeper resets the seat to "available." An additional safety layer is a UNIQUE constraint on the booking items table that prevents two booking records from referencing the same seat. This defense-in-depth approach ensures that even if the application-level locking has a bug, the database constraint prevents double-booking at the storage level.

**Q2: Why would you use a relational database instead of NoSQL for the seat inventory?**

Model Answer: The seat inventory requires strong consistency guarantees — specifically, serializable isolation for the seat hold operation. Relational databases like PostgreSQL and MySQL provide ACID transactions with row-level locking, which directly solves the double-booking problem. NoSQL databases like DynamoDB or Cassandra offer eventual consistency by default, which means two concurrent reads might both see a seat as "available" and both succeed in writing a "held" status. While DynamoDB's conditional writes can provide some level of consistency for single-item operations, they lack the multi-row transaction support needed for booking multiple seats atomically. Furthermore, the seat inventory benefits from relational constraints: foreign keys ensure referential integrity between bookings and seats, CHECK constraints enforce valid status transitions, and UNIQUE constraints prevent duplicate seat records. The write throughput requirement (10,000 TPS during peak) is well within the capability of a properly tuned PostgreSQL or MySQL instance with connection pooling, especially when the virtual queue limits the number of concurrent writers.

**Q3: What happens if a user selects a seat but never completes payment?**

Model Answer: When a user selects a seat, the system places a temporary hold — it sets the seat's status to "held" and records a `hold_expires_at` timestamp (e.g., 10 minutes from now). The seat is unavailable to other users during this window. If the user completes payment, the seat transitions from "held" to "sold" and the hold is cleared. If the user abandons checkout (closes the browser, navigates away), the system does not receive an explicit cancellation signal. Instead, a background sweeper process runs every 30 seconds, executing a query like `UPDATE seat_inventory SET status = 'available', held_by = NULL WHERE status = 'held' AND hold_expires_at < NOW()`. This releases all expired holds, making the seats available to other users. The sweeper approach is more reliable than relying on client-side "unload" events (which are unreliable in browsers) or server-side session timeout detection (which adds complexity). The trade-off is that seats held by abandoned users are unavailable for the duration of the hold, which reduces effective inventory during high-demand sales.

**Mid Tier**

**Q4: How would you design the virtual waiting room for a flash sale?**

Model Answer: The virtual waiting room is a separate, lightweight service that sits between the user and the booking system. When a high-demand sale is scheduled, the system activates the waiting room for that event. Users arriving at the event page are redirected to the waiting room instead of the seat selection page. The waiting room assigns each user a position — either FIFO based on arrival time or lottery-based within a time window. Positions are stored in a Redis sorted set with the position as the score: `ZADD queue:{event_id} {position} {user_token}`. The admission controller maintains a counter of active booking sessions (tracked via Redis: `INCR active_sessions:{event_id}` when a user enters the booking flow, `DECR` when they complete or time out). When the active count drops below the target (e.g., 50,000), the controller pops the next batch of users from the sorted set and marks them as admitted. Each admitted user receives a signed JWT admission token with a short TTL (e.g., 15 minutes). The seat selection API validates this token before processing any request. The waiting room frontend polls a lightweight endpoint every 5 seconds for position updates, served from Redis with no database involvement. This design ensures that the booking backend never sees more than 50,000 concurrent users regardless of how many millions are waiting, and the queue service itself handles the traffic spike because it is a simple read-from-Redis operation that can be horizontally scaled.

**Q5: How would you handle a payment failure after seats have been held?**

Model Answer: This is a distributed transaction problem that requires a saga pattern. The booking flow consists of three steps: (1) hold seats, (2) process payment, (3) confirm booking. If payment fails at step 2, the system must execute a compensating transaction: release the held seats (reverse step 1). The booking service orchestrates this saga. It first calls the seat inventory service to hold the requested seats (step 1). If the hold succeeds, it calls the payment service (step 2). If the payment service returns a failure (card declined, insufficient funds, timeout), the booking service immediately calls the seat inventory service to release the holds. The booking record's status is set to "failed" for auditing. If the payment service times out (ambiguous failure — did the charge go through or not?), the system must not release the seats immediately. Instead, it sets the booking to "pending_verification" and queries the payment gateway asynchronously (via a webhook or polling) to determine the actual outcome. Only after confirming the charge failed does it release the seats. This prevents the scenario where a charge succeeds but the seats are released — which would result in a customer being charged without receiving tickets. Idempotency keys on the payment request ensure that retries do not create duplicate charges.

**Q6: How would you shard the seat inventory database?**

Model Answer: The natural shard key is `event_id`. Each event's seats are entirely independent — there are no queries or transactions that span multiple events. Sharding by event_id ensures that all seats for a given event reside on the same shard, allowing single-shard transactions for the critical hold and booking operations. I would use consistent hashing with virtual nodes: each physical database shard is assigned multiple positions on a hash ring, and `hash(event_id)` determines which shard owns a given event. This allows adding new shards with minimal data redistribution. For hot events (the Taylor Swift problem), a single shard handles all the write traffic for that event. The virtual queue ensures that write concurrency is bounded (e.g., 50,000 active sessions), so a well-provisioned shard (e.g., a 64GB RAM, 16-core PostgreSQL instance with NVMe storage) can handle the load. If a single shard is insufficient for the most extreme events, we can further partition within an event by section (each section's seats on a separate shard), though this adds complexity for multi-section bookings and is rarely necessary with proper queue management.

**Senior Tier**

**Q7: How would you handle the scenario where the queue service itself fails during a flash sale?**

Model Answer: The queue service is the single most critical component during a flash sale, and its failure mode must be carefully designed. The system should fail closed: if the queue service is unavailable, users see a "please try again shortly" message rather than being admitted directly to the booking system (which would cause a thundering herd and crash the backend). To achieve high availability, the queue service runs across multiple availability zones with active-active replication. Redis Cluster provides the backing store with automatic failover. The queue service itself is stateless — all state lives in Redis — so any instance can serve any request. Health checks from the load balancer remove unhealthy instances within seconds. For disaster recovery, we maintain a standby queue implementation at the edge (e.g., Cloudflare Waiting Room as a fallback). If our custom queue service becomes completely unreachable, DNS-based failover routes traffic to the edge-based queue within 30-60 seconds. The admission tokens are validated cryptographically (JWT signature verification), not by calling the queue service, so the booking system can validate admissions even if the queue service is temporarily unreachable. The key insight is that a queue failure should never result in uncontrolled admission — better to block all users temporarily than to flood the backend.

**Q8: How would you design the system to support a venue with 100,000 seats where every seat must be individually selectable on an interactive map?**

Model Answer: A 100,000-seat venue with individual seat selection presents challenges at every layer. At the frontend, rendering 100,000 interactive seat elements in the DOM is infeasible — the browser would become unresponsive. Instead, the seat map uses a tiled rendering approach similar to Google Maps: the full venue is rendered as image tiles at multiple zoom levels. At the highest zoom level, individual seats are interactive SVG or Canvas elements. The frontend loads only the tiles for the user's current viewport, fetching additional tiles on pan/zoom. Availability data is loaded per-section: when the user zooms into a section, the frontend fetches that section's seat availability from the API. This reduces the initial payload from 100K seat records to perhaps 50 section summaries. At the backend, the seat inventory for this event is approximately 100,000 rows x 200 bytes = 20 MB — easily fits in memory. We cache section-level availability in Redis with a 2-second TTL: `HSET avail:{event_id}:{section_id} {seat_number} {status}`. This cache is invalidated on every hold/release. For the write path, we use pessimistic locking at the individual seat level — contention is distributed across 100,000 seats, so the per-seat conflict rate is manageable. The critical optimization is pre-computing the seat map tiles and availability summaries asynchronously (via a background worker triggered by seat status changes) rather than computing them on every request.

**Q9: If Ticketmaster asked you to redesign their system to guarantee zero downtime during flash sales, what architectural changes would you propose?**

Model Answer: Zero downtime during flash sales requires eliminating every single point of failure in the critical path. First, I would implement a multi-region active-active architecture where each region independently handles a subset of events. For a specific event, one region is the "primary" owner (handling writes), while other regions serve read traffic and queue management. CRDTs (Conflict-free Replicated Data Types) are not suitable for seat inventory (they cannot prevent double-booking), so we accept that writes are single-region for correctness. Second, I would move the queue service entirely to the edge using multiple CDN providers (Cloudflare + Akamai + CloudFront) in an active-active configuration with DNS-based failover. This ensures the queue survives any single provider outage. Third, I would implement a pre-computed allocation model for the highest-demand events: instead of real-time seat selection, users in the queue are pre-assigned seats based on their preferences (section, price range) before being admitted to checkout. This converts the high-contention seat selection problem into a batch assignment problem that can be solved offline. Fourth, all inter-service communication on the critical path uses synchronous calls with aggressive timeouts (500ms) and circuit breakers, with fallback behaviors defined for every dependency. Fifth, the entire system undergoes chaos engineering: regular failure injection in production to validate that every component's failure mode is graceful. The payment integration uses at least two independent payment processors in active-active configuration — if Stripe fails, the system falls through to Adyen. Finally, every flash sale is preceded by a load test that simulates 120% of expected peak traffic, with a go/no-go decision based on the results.

---

### Section 11 — Complete Code Example

This implementation demonstrates the four critical subsystems of a ticket booking system: seat reservation with distributed locking, temporary hold with TTL, virtual queue with controlled admission, and the end-to-end booking flow.

**Pseudocode: Core Booking Flow**

```
FUNCTION bookTickets(userId, eventId, seatIds):
    -- Step 1: Verify user is admitted from the queue
    admissionToken = getAdmissionToken(userId, eventId)
    IF NOT verifyAdmissionToken(admissionToken):
        RETURN Error("Not admitted — please wait in queue")

    -- Step 2: Attempt to hold all requested seats
    BEGIN TRANSACTION
        FOR EACH seatId IN seatIds:
            seat = SELECT * FROM seat_inventory
                   WHERE seat_id = seatId AND event_id = eventId
                   FOR UPDATE  -- acquire row-level lock

            IF seat.status != 'available':
                ROLLBACK TRANSACTION
                RETURN Error("Seat " + seatId + " is no longer available")

            UPDATE seat_inventory
               SET status = 'held',
                   held_by = userId,
                   hold_expires_at = NOW() + INTERVAL '10 MINUTES'
             WHERE seat_id = seatId
    COMMIT TRANSACTION

    -- Step 3: Create pending booking record
    booking = INSERT INTO bookings (user_id, event_id, total_cents, status)
              VALUES (userId, eventId, sumPrices(seatIds), 'pending')

    -- Step 4: Process payment
    paymentResult = paymentService.charge(userId, booking.total_cents, booking.booking_id)

    IF paymentResult.success:
        -- Step 5a: Confirm booking
        BEGIN TRANSACTION
            UPDATE bookings SET status = 'confirmed', payment_id = paymentResult.id
             WHERE booking_id = booking.booking_id
            UPDATE seat_inventory SET status = 'sold'
             WHERE seat_id IN seatIds
        COMMIT TRANSACTION
        notificationService.sendConfirmation(userId, booking.booking_id)
        RETURN Success(booking)
    ELSE:
        -- Step 5b: Compensate — release seats
        UPDATE seat_inventory
           SET status = 'available', held_by = NULL, hold_expires_at = NULL
         WHERE seat_id IN seatIds
        UPDATE bookings SET status = 'failed'
         WHERE booking_id = booking.booking_id
        RETURN Error("Payment failed: " + paymentResult.reason)


FUNCTION sweepExpiredHolds():
    -- Runs every 30 seconds via cron/scheduler
    UPDATE seat_inventory
       SET status = 'available', held_by = NULL, hold_expires_at = NULL
     WHERE status = 'held' AND hold_expires_at < NOW()


FUNCTION admitFromQueue(eventId):
    -- Runs continuously, controlled by admission controller
    activeCount = Redis.GET("active_sessions:" + eventId)
    targetConcurrency = 50000
    IF activeCount < targetConcurrency:
        batchSize = targetConcurrency - activeCount
        nextUsers = Redis.ZPOPMIN("queue:" + eventId, batchSize)
        FOR EACH user IN nextUsers:
            token = generateAdmissionJWT(user.id, eventId, TTL=15min)
            Redis.SET("admission:" + eventId + ":" + user.id, token, EX=900)
            notifyUser(user.id, "You have been admitted!")
            Redis.INCR("active_sessions:" + eventId)
```

**Node.js Implementation**

```javascript
// ============================================================
// ticket-booking-system.js
// Complete implementation of a ticket booking system with
// distributed locking, virtual queue, and booking orchestration
// ============================================================

const express = require('express');
const Redis = require('ioredis');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ------------------------------------------------------------
// Configuration constants
// ------------------------------------------------------------
const HOLD_DURATION_SECONDS = 600;        // 10-minute seat hold
const ADMISSION_TTL_SECONDS = 900;        // 15-minute admission window
const TARGET_CONCURRENCY = 50000;         // Max concurrent booking sessions
const QUEUE_POLL_INTERVAL_MS = 1000;      // Admission controller frequency
const SWEEP_INTERVAL_MS = 30000;          // Hold expiry sweep frequency
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ------------------------------------------------------------
// Database and Redis connections
// ------------------------------------------------------------
// PostgreSQL connection pool for the seat inventory database.
// max: 50 limits database connections to prevent exhaustion
// under high load. idleTimeoutMillis closes idle connections
// after 30 seconds to free resources.
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  database: 'ticket_booking',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Redis client for queue management and distributed locking.
// enableReadyCheck ensures commands wait until Redis is fully
// initialized. maxRetriesPerRequest limits retry attempts to
// prevent infinite loops during Redis outages.
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
});

const app = express();
app.use(express.json());

// ============================================================
// VIRTUAL QUEUE SERVICE
// ============================================================

// joinQueue: adds a user to the waiting room for an event.
// The user's position is their join timestamp (epoch ms),
// stored as the score in a Redis sorted set. This gives us
// natural FIFO ordering — users who joined earlier have lower
// scores and are dequeued first.
async function joinQueue(userId, eventId) {
  const position = Date.now();                                    // Line 1: Use current timestamp as queue position for FIFO ordering
  const token = crypto.randomUUID();                              // Line 2: Generate unique token for this queue entry
  const queueKey = `queue:${eventId}`;                            // Line 3: Redis key for this event's queue (sorted set)
  const memberValue = JSON.stringify({ userId, token });          // Line 4: Store both userId and token as the sorted set member

  await redis.zadd(queueKey, position, memberValue);              // Line 5: ZADD atomically inserts into the sorted set with position as score

  const rank = await redis.zrank(queueKey, memberValue);          // Line 6: ZRANK returns 0-based position in the sorted set
  const totalWaiting = await redis.zcard(queueKey);               // Line 7: ZCARD returns total number of users in the queue

  return {                                                        // Line 8: Return queue status to the user
    token,
    position: rank + 1,                                           // Line 9: Convert 0-based rank to 1-based position for display
    totalWaiting,
    estimatedWaitSeconds: Math.ceil((rank + 1) / 500),            // Line 10: Rough estimate assuming 500 admissions per second
  };
}

// getQueueStatus: returns the current position and estimated
// wait time for a queued user. The frontend polls this endpoint
// every 5-10 seconds to update the waiting room UI.
async function getQueueStatus(userId, eventId, token) {
  const queueKey = `queue:${eventId}`;
  const memberValue = JSON.stringify({ userId, token });

  const rank = await redis.zrank(queueKey, memberValue);          // Line 1: Check if user is still in the queue
  if (rank === null) {
    // User is not in the queue — either admitted or never joined
    const admissionKey = `admission:${eventId}:${userId}`;
    const admissionToken = await redis.get(admissionKey);         // Line 2: Check if user has been admitted
    if (admissionToken) {
      return { status: 'admitted', admissionToken };              // Line 3: User was admitted — return the admission token
    }
    return { status: 'not_in_queue' };                            // Line 4: User is neither queued nor admitted
  }

  const totalWaiting = await redis.zcard(queueKey);
  return {                                                        // Line 5: User is still waiting — return updated position
    status: 'waiting',
    position: rank + 1,
    totalWaiting,
    estimatedWaitSeconds: Math.ceil((rank + 1) / 500),
  };
}

// admitFromQueue: the admission controller. It runs in a loop,
// checking the current number of active booking sessions and
// admitting users from the queue to maintain the target concurrency.
// This is the "valve" that protects the booking backend from overload.
async function admitFromQueue(eventId) {
  const activeKey = `active_sessions:${eventId}`;
  const queueKey = `queue:${eventId}`;

  const activeCount = parseInt(await redis.get(activeKey) || '0', 10);  // Line 1: Get current number of active booking sessions
  const availableSlots = TARGET_CONCURRENCY - activeCount;              // Line 2: Calculate how many new users we can admit

  if (availableSlots <= 0) {
    return 0;                                                           // Line 3: At capacity — admit no one
  }

  // ZPOPMIN atomically removes and returns the members with the
  // lowest scores (earliest arrivals in FIFO order). We pop up
  // to availableSlots users in a single command.
  const batchSize = Math.min(availableSlots, 1000);                     // Line 4: Cap batch size to prevent overshooting
  const popped = await redis.zpopmin(queueKey, batchSize);              // Line 5: Atomically dequeue the next batch of users

  let admittedCount = 0;
  // ZPOPMIN returns [member1, score1, member2, score2, ...]
  for (let i = 0; i < popped.length; i += 2) {                         // Line 6: Iterate through popped members (pairs of value, score)
    const { userId } = JSON.parse(popped[i]);                           // Line 7: Parse the stored userId from the member value

    // Generate a signed JWT admission token. This token is
    // verified by the booking API to ensure only admitted users
    // can select seats. The JWT contains the userId and eventId,
    // and expires after ADMISSION_TTL_SECONDS.
    const admissionToken = jwt.sign(                                    // Line 8: Create a cryptographically signed admission token
      { userId, eventId, type: 'admission' },
      JWT_SECRET,
      { expiresIn: ADMISSION_TTL_SECONDS }
    );

    const admissionKey = `admission:${eventId}:${userId}`;
    await redis.set(admissionKey, admissionToken, 'EX', ADMISSION_TTL_SECONDS);  // Line 9: Store admission token in Redis for quick lookup
    await redis.incr(activeKey);                                        // Line 10: Increment active session counter
    admittedCount++;
  }

  return admittedCount;                                                 // Line 11: Return number of users admitted in this batch
}

// verifyAdmission: validates that a user has been admitted from
// the queue and is authorized to access the booking flow.
function verifyAdmission(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);                // Line 1: Verify JWT signature and check expiration
    if (decoded.type !== 'admission') {
      return null;                                                // Line 2: Reject tokens that are not admission tokens
    }
    return decoded;                                               // Line 3: Return decoded payload (userId, eventId)
  } catch (err) {
    return null;                                                  // Line 4: Invalid or expired token — return null
  }
}

// ============================================================
// SEAT INVENTORY SERVICE
// ============================================================

// holdSeats: the core seat reservation function. Uses pessimistic
// locking (SELECT FOR UPDATE) within a database transaction to
// prevent double-booking. Each seat is locked individually, its
// status is checked, and if available, it is set to 'held' with
// a TTL. If any seat is unavailable, the entire transaction rolls
// back — either all seats are held or none are.
async function holdSeats(userId, eventId, seatIds) {
  const client = await db.connect();                              // Line 1: Acquire a dedicated connection from the pool for the transaction
  try {
    await client.query('BEGIN');                                   // Line 2: Start a database transaction

    const heldSeats = [];
    for (const seatId of seatIds) {
      // SELECT FOR UPDATE acquires an exclusive row-level lock.
      // If another transaction holds this lock, we block until
      // it releases (commit or rollback). This serializes
      // concurrent attempts to hold the same seat.
      const result = await client.query(                          // Line 3: Lock the seat row with SELECT FOR UPDATE
        `SELECT seat_id, status, price_cents
         FROM seat_inventory
         WHERE seat_id = $1 AND event_id = $2
         FOR UPDATE`,
        [seatId, eventId]
      );

      if (result.rows.length === 0) {                             // Line 4: Seat does not exist for this event
        await client.query('ROLLBACK');
        return { success: false, error: `Seat ${seatId} not found` };
      }

      const seat = result.rows[0];
      if (seat.status !== 'available') {                          // Line 5: Seat exists but is already held or sold
        await client.query('ROLLBACK');                           // Line 6: Rollback releases all locks acquired in this transaction
        return {
          success: false,
          error: `Seat ${seatId} is ${seat.status}`,
        };
      }

      // Set the seat to 'held' with a TTL. The hold_expires_at
      // timestamp is used by the sweeper to release abandoned holds.
      const holdExpiry = new Date(Date.now() + HOLD_DURATION_SECONDS * 1000);
      await client.query(                                         // Line 7: Update seat status to 'held' with expiry
        `UPDATE seat_inventory
         SET status = 'held',
             held_by = $1,
             hold_expires_at = $2
         WHERE seat_id = $3`,
        [userId, holdExpiry, seatId]
      );

      heldSeats.push({                                            // Line 8: Track successfully held seats for the response
        seatId: seat.seat_id,
        priceCents: seat.price_cents,
      });
    }

    await client.query('COMMIT');                                 // Line 9: Commit transaction — all locks are released, all holds are durable

    return {                                                      // Line 10: Return success with held seat details
      success: true,
      seats: heldSeats,
      holdExpiresAt: new Date(Date.now() + HOLD_DURATION_SECONDS * 1000),
      totalCents: heldSeats.reduce((sum, s) => sum + s.priceCents, 0),
    };
  } catch (err) {
    await client.query('ROLLBACK');                               // Line 11: On any error, rollback to release locks and revert changes
    throw err;
  } finally {
    client.release();                                             // Line 12: Always return the connection to the pool
  }
}

// releaseSeats: compensating transaction to release held seats.
// Called when payment fails or hold expires. This is the "undo"
// operation for holdSeats.
async function releaseSeats(userId, eventId, seatIds) {
  const result = await db.query(                                  // Line 1: Release seats back to 'available'
    `UPDATE seat_inventory
     SET status = 'available',
         held_by = NULL,
         hold_expires_at = NULL
     WHERE event_id = $1
       AND seat_id = ANY($2)
       AND held_by = $3
       AND status = 'held'`,                                      // Line 2: Only release seats held by this specific user
    [eventId, seatIds, userId]
  );
  return result.rowCount;                                         // Line 3: Return number of seats released
}

// sweepExpiredHolds: background job that runs every 30 seconds
// to release seats whose hold has expired. This handles the case
// where a user abandons checkout without explicitly cancelling.
async function sweepExpiredHolds() {
  const result = await db.query(
    `UPDATE seat_inventory
     SET status = 'available',
         held_by = NULL,
         hold_expires_at = NULL
     WHERE status = 'held'
       AND hold_expires_at < NOW()`                               // Line 1: Find all seats whose hold has expired
  );
  if (result.rowCount > 0) {
    console.log(`Swept ${result.rowCount} expired seat holds`);   // Line 2: Log for monitoring — track hold abandonment rate
  }
}

// ============================================================
// BOOKING ORCHESTRATOR
// ============================================================

// createBooking: orchestrates the complete booking flow as a
// saga. Steps: hold seats -> create booking record -> process
// payment -> confirm or compensate. Each step has explicit
// error handling and compensation logic.
async function createBooking(userId, eventId, seatIds, paymentMethod) {
  // Step 1: Hold the seats
  const holdResult = await holdSeats(userId, eventId, seatIds);   // Line 1: Attempt to hold all requested seats
  if (!holdResult.success) {
    return { success: false, error: holdResult.error };           // Line 2: Seat hold failed — return error immediately
  }

  // Step 2: Create a pending booking record
  const bookingResult = await db.query(                           // Line 3: Insert a booking record with 'pending' status
    `INSERT INTO bookings (user_id, event_id, total_cents, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING booking_id`,
    [userId, eventId, holdResult.totalCents]
  );
  const bookingId = bookingResult.rows[0].booking_id;

  // Insert individual booking items (seat-to-booking mapping)
  for (const seat of holdResult.seats) {                          // Line 4: Record each seat in the booking
    await db.query(
      `INSERT INTO booking_items (booking_id, seat_id, price_cents)
       VALUES ($1, $2, $3)`,
      [bookingId, seat.seatId, seat.priceCents]
    );
  }

  // Step 3: Process payment
  let paymentResult;
  try {
    paymentResult = await processPayment({                        // Line 5: Call external payment service
      amount: holdResult.totalCents,
      currency: 'usd',
      paymentMethod,
      bookingId,                                                  // Line 6: Booking ID serves as idempotency key
    });
  } catch (paymentError) {
    // Payment service threw an error — compensate by releasing seats
    console.error('Payment error:', paymentError.message);
    await releaseSeats(userId, eventId, seatIds);                 // Line 7: Compensating transaction — release held seats
    await db.query(
      `UPDATE bookings SET status = 'failed' WHERE booking_id = $1`,
      [bookingId]
    );
    return { success: false, error: 'Payment processing failed' };
  }

  if (!paymentResult.success) {
    // Payment was processed but declined
    await releaseSeats(userId, eventId, seatIds);                 // Line 8: Release seats on payment decline
    await db.query(
      `UPDATE bookings SET status = 'failed' WHERE booking_id = $1`,
      [bookingId]
    );
    return {
      success: false,
      error: `Payment declined: ${paymentResult.reason}`,
    };
  }

  // Step 4: Confirm the booking — transition seats from 'held' to 'sold'
  const client = await db.connect();
  try {
    await client.query('BEGIN');                                   // Line 9: Start confirmation transaction
    await client.query(
      `UPDATE bookings
       SET status = 'confirmed',
           payment_id = $1,
           confirmed_at = NOW()
       WHERE booking_id = $2`,
      [paymentResult.paymentId, bookingId]
    );
    await client.query(                                           // Line 10: Transition seats from 'held' to 'sold'
      `UPDATE seat_inventory
       SET status = 'sold',
           booking_id = $1
       WHERE seat_id = ANY($2)
         AND event_id = $3`,
      [bookingId, seatIds, eventId]
    );
    await client.query('COMMIT');                                 // Line 11: Commit — booking is now final
  } catch (err) {
    await client.query('ROLLBACK');
    // This is a critical failure — payment succeeded but DB update failed.
    // Log for manual resolution and alert operations team.
    console.error('CRITICAL: Payment succeeded but booking confirmation failed', {
      bookingId,
      paymentId: paymentResult.paymentId,
      error: err.message,
    });
    return {
      success: false,
      error: 'Booking confirmation failed — support has been notified',
    };
  } finally {
    client.release();
  }

  // Step 5: Decrement active session counter (user is done)
  await redis.decr(`active_sessions:${eventId}`);                 // Line 12: Free up a slot for the next queued user

  return {                                                        // Line 13: Return confirmed booking details
    success: true,
    bookingId,
    seats: holdResult.seats,
    totalCents: holdResult.totalCents,
    paymentId: paymentResult.paymentId,
    confirmedAt: new Date(),
  };
}

// ============================================================
// PAYMENT SERVICE (SIMULATED)
// ============================================================

// processPayment: simulates an external payment gateway call.
// In production, this would call Stripe, Braintree, or similar.
// The bookingId is used as an idempotency key to prevent
// duplicate charges on retry.
async function processPayment({ amount, currency, paymentMethod, bookingId }) {
  // Simulate network latency to payment gateway
  await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));

  // Simulate 95% success rate
  if (Math.random() < 0.05) {
    return {
      success: false,
      reason: 'Card declined by issuer',
    };
  }

  return {
    success: true,
    paymentId: `pay_${crypto.randomUUID()}`,                      // Line 1: Generate a unique payment reference ID
    amount,
    currency,
  };
}

// ============================================================
// API ROUTES
// ============================================================

// POST /api/queue/join — User joins the waiting room for an event
app.post('/api/queue/join', async (req, res) => {
  try {
    const { userId, eventId } = req.body;
    if (!userId || !eventId) {
      return res.status(400).json({ error: 'userId and eventId are required' });
    }
    const result = await joinQueue(userId, eventId);
    res.json(result);
  } catch (err) {
    console.error('Queue join error:', err);
    res.status(500).json({ error: 'Failed to join queue' });
  }
});

// GET /api/queue/status — User polls for queue position and admission
app.get('/api/queue/status', async (req, res) => {
  try {
    const { userId, eventId, token } = req.query;
    const result = await getQueueStatus(userId, eventId, token);
    res.json(result);
  } catch (err) {
    console.error('Queue status error:', err);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

// POST /api/booking/hold — Admitted user selects and holds seats
app.post('/api/booking/hold', async (req, res) => {
  try {
    const { admissionToken, eventId, seatIds } = req.body;

    // Verify the user has been admitted from the queue
    const admission = verifyAdmission(admissionToken);            // Line 1: Validate the JWT admission token
    if (!admission) {
      return res.status(403).json({
        error: 'Invalid or expired admission — please rejoin the queue',
      });
    }

    if (admission.eventId !== eventId) {                          // Line 2: Ensure admission is for the correct event
      return res.status(403).json({
        error: 'Admission token is for a different event',
      });
    }

    const result = await holdSeats(admission.userId, eventId, seatIds);
    if (result.success) {
      res.json(result);
    } else {
      res.status(409).json(result);                               // Line 3: 409 Conflict — seat is no longer available
    }
  } catch (err) {
    console.error('Hold error:', err);
    res.status(500).json({ error: 'Failed to hold seats' });
  }
});

// POST /api/booking/confirm — Complete the booking with payment
app.post('/api/booking/confirm', async (req, res) => {
  try {
    const { admissionToken, eventId, seatIds, paymentMethod } = req.body;

    const admission = verifyAdmission(admissionToken);
    if (!admission) {
      return res.status(403).json({
        error: 'Invalid or expired admission',
      });
    }

    const result = await createBooking(
      admission.userId,
      eventId,
      seatIds,
      paymentMethod
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Booking failed' });
  }
});

// GET /api/events/:eventId/availability — Seat availability for browsing
app.get('/api/events/:eventId/availability', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { section } = req.query;

    let query, params;
    if (section) {
      // Section-level detail: individual seat availability
      query = `SELECT seat_id, section, row_name, seat_number, price_cents, status
               FROM seat_inventory
               WHERE event_id = $1 AND section = $2
               ORDER BY row_name, seat_number`;
      params = [eventId, section];
    } else {
      // Event-level summary: aggregated availability per section
      query = `SELECT section,
                      COUNT(*) AS total_seats,
                      COUNT(*) FILTER (WHERE status = 'available') AS available,
                      MIN(price_cents) AS min_price,
                      MAX(price_cents) AS max_price
               FROM seat_inventory
               WHERE event_id = $1
               GROUP BY section
               ORDER BY section`;
      params = [eventId];
    }

    const result = await db.query(query, params);                 // Line 1: Query read replica in production for scalability
    res.json({ seats: result.rows });
  } catch (err) {
    console.error('Availability error:', err);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// ============================================================
// BACKGROUND WORKERS
// ============================================================

// Start the admission controller loop. This continuously
// checks if there is capacity to admit more users from the
// queue and admits them in batches.
function startAdmissionController(eventId) {
  setInterval(async () => {
    try {
      const admitted = await admitFromQueue(eventId);
      if (admitted > 0) {
        console.log(`Admitted ${admitted} users for event ${eventId}`);
      }
    } catch (err) {
      console.error('Admission controller error:', err);
      // Do NOT crash — fail closed (stop admitting) until next tick
    }
  }, QUEUE_POLL_INTERVAL_MS);
}

// Start the hold expiry sweeper. This releases seats whose
// hold has expired, making them available for other users.
function startHoldSweeper() {
  setInterval(async () => {
    try {
      await sweepExpiredHolds();
    } catch (err) {
      console.error('Hold sweeper error:', err);
    }
  }, SWEEP_INTERVAL_MS);
}

// ============================================================
// SERVER STARTUP
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ticket booking service running on port ${PORT}`);

  // Start background workers
  startHoldSweeper();                                             // Line 1: Begin sweeping expired holds every 30 seconds

  // In production, the admission controller would be started
  // dynamically when a flash sale event is activated.
  // For demonstration, we start it for a sample event.
  // startAdmissionController('event_12345');

  console.log('Background workers started');
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

// On shutdown, close database and Redis connections cleanly
// to prevent connection leaks and ensure in-flight transactions
// are completed or rolled back.
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await db.end();                                                 // Line 1: Close all PostgreSQL connections in the pool
  await redis.quit();                                             // Line 2: Close Redis connection cleanly
  process.exit(0);
});
```

**Code Walkthrough Summary**

The implementation above demonstrates several critical patterns. The **virtual queue** uses Redis sorted sets for O(log N) insertion and O(1) dequeue, with JWT tokens for stateless admission verification. The **seat hold** uses PostgreSQL's `SELECT ... FOR UPDATE` within a transaction to prevent double-booking, combined with a TTL-based expiry for abandoned checkouts. The **booking orchestrator** implements the saga pattern: hold seats, process payment, confirm — with compensating transactions (seat release) if any step fails. The **admission controller** runs as a background loop, acting as a controlled valve that admits users from the queue at a rate the booking backend can handle. The **hold sweeper** runs periodically to reclaim seats from abandoned sessions.

In a production deployment, these components would be separate microservices rather than a single Express application. The queue service would run on dedicated, horizontally-scaled instances behind a CDN. The seat inventory service would be backed by a sharded PostgreSQL cluster with read replicas. The booking orchestrator would use a message queue (SQS, Kafka) for the notification and ticket generation steps, keeping the synchronous booking path as fast as possible.

---

### Section 12 — Connection to Next Topic

A ticket booking system like Ticketmaster exposes one of the harshest truths in distributed systems engineering: you cannot improve what you cannot measure. During the Eras Tour disaster, Ticketmaster's public postmortem revealed that the system's monitoring did not provide sufficient early warning of the cascading failure — by the time engineers recognized the severity, recovery options were limited. The queue service was overwhelmed before alerts fired. Database connection pools were exhausted before dashboards updated. The gap between what was happening in the system and what the operations team could see was measured in critical minutes.

This directly motivates our next topic: **Design a Metrics and Monitoring System (Topic 55)**. Where Topic 54 focused on building a system that handles extreme traffic, Topic 55 focuses on building the observability layer that lets you understand whether your system is handling traffic correctly, detect anomalies before they become outages, and diagnose failures when they occur.

The transition from ticket booking to metrics and monitoring is natural. Every component we designed in this topic — the virtual queue, the seat inventory, the booking orchestrator, the payment integration — needs instrumentation. How many users are in the queue? What is the 99th percentile seat-hold latency? What percentage of payment attempts are failing? How many expired holds is the sweeper releasing per minute (an indicator of checkout abandonment rate)? These questions require a metrics collection pipeline that can ingest millions of data points per second, store them efficiently for time-series queries, and surface actionable alerts in real time.

In Topic 55, you will design that pipeline: from metrics emission (counters, gauges, histograms) through collection and aggregation (StatsD, Prometheus, OpenTelemetry), storage (time-series databases like InfluxDB or Prometheus TSDB), visualization (Grafana dashboards), and alerting (PagerDuty integration with intelligent thresholds). The skills you practiced here — handling write-heavy workloads, managing hot keys, designing for extreme scale — will directly inform how you architect a monitoring system capable of observing systems at Ticketmaster's scale. After all, the monitoring system itself must handle the same traffic spikes that stress the systems it monitors.

---

<!--
Topic: 55
Title: Design a Metrics and Monitoring System (Datadog)
Section: 11 — Real-World Designs Part 3
Track: 0-to-100 Deep Mastery
Difficulty: Senior
Interview Weight: Medium
Prerequisites: Topics 6, 14, 25-27, 38-39
Next Topic: Topic 56 (Microservices vs Monolith Architecture)
Version: 1.0
Last Updated: 2025-05-01
-->

## Topic 55: Design a Metrics and Monitoring System (Datadog)

---

### Section 1 — Why This Design?

The story of monitoring is really the story of operators getting tired of being surprised at 3 AM. In 1999, Ethan Galstad released Nagios, originally called "NetSaint," a host-and-service check framework that would become the default monitoring tool for a generation of sysadmins. Nagios worked by polling services and reporting binary status — up or down, green or red. It was revolutionary for its time, but it carried a fundamental limitation: it could tell you that something was broken, but not why, and it certainly could not show you the trend that led to the breakage. The world needed something that captured continuous numerical data over time.

Graphite arrived in 2008, created by Chris Davis at Orbitz, and it changed the game. Graphite introduced the concept of storing and querying time-series metrics — CPU usage not as a single check, but as a continuous stream of data points you could graph, correlate, and analyze. Graphite's whisper storage format and its simple "metric.path.name value timestamp" protocol made it trivially easy to instrument applications. Suddenly, engineers could overlay deployment events on error-rate graphs and see causation, not just correlation. But Graphite had its own weaknesses: it was designed for a single-host deployment, its fixed-size storage files wasted space for sparse metrics, and it had no built-in alerting.

Two parallel movements then reshaped the landscape. At SoundCloud in 2012, Matt Proud and Julius Volz created Prometheus, a monitoring system built for the ephemeral, label-rich world of containerized microservices. Prometheus introduced a pull-based model where the monitoring server scrapes targets, a powerful multi-dimensional data model with labels instead of hierarchical metric names, and PromQL — a query language purpose-built for time-series aggregation. Prometheus became the de facto standard for Kubernetes monitoring and was the second project to graduate from the Cloud Native Computing Foundation after Kubernetes itself.

Meanwhile, in 2010, Olivier Pomel and Alexis Le-Quoc founded Datadog in New York City. Both had experienced the pain of operating large-scale infrastructure at Wireless Generation, and they envisioned a SaaS monitoring platform that would unify metrics, traces, and logs into a single pane of glass. Datadog's insight was that monitoring should not be something you operate yourself — it should be a service. By 2023, Datadog was processing trillions of data points per day, serving over 26,000 customers, and had expanded from infrastructure monitoring into APM, log management, security monitoring, and CI visibility. InfluxDB (2013) carved out a niche as a purpose-built open-source time-series database, and Grafana (2014) became the universal visualization layer that could query Prometheus, Graphite, InfluxDB, and dozens of other sources.

This design problem is a favorite in senior system design interviews because it tests a broad spectrum of skills simultaneously. You must reason about time-series data modeling (a fundamentally different storage paradigm from OLTP or OLAP), high-throughput write pipelines (millions of data points per second), real-time query engines that aggregate across massive datasets, and an alerting system that evaluates millions of rules without drowning the on-call engineer in noise. It also tests your understanding of data lifecycle management — how to keep seconds-resolution data for a week but years of hourly rollups without bankrupting the storage budget. If you can design a monitoring system well, you are demonstrating mastery of streaming architecture, specialized storage engines, and operational empathy.

---

### Section 2 — Requirements Gathering

Every system design interview should begin with requirements clarification, and monitoring systems demand especially careful scoping because the feature surface is enormous. A candidate who jumps straight into drawing boxes will miss critical constraints. Let us establish what we are building.

**Functional Requirements:**

The system must ingest metrics from thousands of heterogeneous services — bare-metal servers, VMs, containers, serverless functions, databases, message brokers, and custom application code. Each metric is a named numerical measurement associated with a set of key-value tags (for example, `http.request.duration{service=checkout, endpoint=/pay, region=us-east-1, status=200}`). The system must store this time-series data durably and make it queryable. Engineers must be able to build dashboards that visualize metrics with graphs, heatmaps, and tables, applying aggregation functions like sum, average, percentile, and rate over configurable time windows. The system must support an alerting engine where users define threshold-based rules (e.g., "alert if p99 latency > 500ms for 5 minutes") and receive notifications via integrations like PagerDuty, Slack, and email. Finally, the system should support tagging and filtering, so users can slice metrics by host, region, service, or any custom dimension.

**Non-Functional Requirements:**

Scale is the defining non-functional requirement. The system must handle ingestion of 10 million or more unique metric data points per second from a combined fleet of tens of thousands of services. Dashboard queries must return within 1 second — engineers debugging a production incident cannot wait 30 seconds for a graph to load. Data must be retained for years (with decreasing resolution over time) to support capacity planning and year-over-year comparison. The system must be highly available; if the monitoring system is down during an outage, you are flying blind. Write throughput must be prioritized over read throughput because metric ingestion is continuous and cannot be replayed easily, whereas queries can tolerate brief degradation. The system should support multi-tenancy so that different teams or customers get isolated views of their data.

**Back-of-Envelope Estimation:**

Let us size this system concretely. Assume a large organization with 10,000 services, where each service emits 1,000 distinct metric time series (a moderate assumption — a single Kubernetes node with system-level and application-level instrumentation easily produces this many). That gives us 10,000 x 1,000 = 10 million unique time series.

If each service reports at 10-second resolution (a common default for infrastructure metrics), each time series generates 6 data points per minute, 360 per hour, and 8,640 per day. Each data point consists of a timestamp (8 bytes), a float64 value (8 bytes), and some overhead for series identification. With compression (using techniques like Gorilla/Facebook's time-series compression, which typically achieves 1.37 bytes per data point), the storage per data point drops to approximately 2 bytes effective.

Daily raw storage: 10M series x 8,640 points/day x 2 bytes = 172.8 GB/day. Monthly: approximately 5.2 TB. Yearly: approximately 63 TB. This is for raw resolution only. With downsampling (1-minute rollups after 7 days, 1-hour rollups after 30 days, 1-day rollups after 1 year), long-term storage shrinks by orders of magnitude.

Ingestion rate: 10M series / 10 seconds = 1,000,000 data points per second at steady state. Factoring in burst traffic (deployments, auto-scaling events), we should design for 3-5x bursts, so 3-5 million data points per second peak.

Query load: Assume 1,000 concurrent dashboard viewers, each dashboard containing 20 panels, each panel refreshing every 30 seconds. That is 1,000 x 20 / 30 = approximately 667 queries per second. Each query might fan out across multiple shards and aggregate millions of data points, so the query engine needs significant compute.

Network bandwidth for ingestion: At 1M points/sec, with each point being roughly 100 bytes on the wire (metric name, tags, timestamp, value in a text protocol like StatsD), that is 100 MB/s or about 800 Mbps. With binary protocols and compression, this drops to perhaps 200-300 Mbps — manageable for a well-provisioned ingestion tier.

---

### Section 3 — High-Level Architecture

The architecture of a metrics and monitoring system follows a classic streaming data pipeline with specialized storage. At the highest level, data flows from left to right: collection, ingestion, storage, query, and presentation. Let us walk through each layer.

Agents run on every monitored host. These lightweight processes (like the Datadog Agent, Prometheus node_exporter, or Telegraf) collect system metrics (CPU, memory, disk, network), scrape application metrics endpoints, and forward them to the ingestion tier. Agents handle local buffering, batching, and compression to reduce network overhead. They also enrich data points with host-level metadata (hostname, region, availability zone, instance type) before sending.

The ingestion gateway is a horizontally scaled fleet of stateless servers that receive metric payloads over HTTP, gRPC, or UDP (StatsD protocol). These gateways validate incoming data (rejecting malformed payloads, enforcing tag cardinality limits), perform rate limiting per tenant, and write accepted data into a durable message buffer — typically Apache Kafka. Using Kafka as an intermediate buffer is critical: it decouples the ingestion rate from the storage write rate, absorbs traffic bursts, and provides replay capability if a downstream consumer fails.

The write pipeline consists of consumer processes that read from Kafka, partition the data by metric identity (ensuring all points for the same time series land on the same storage node), and batch-write into the time-series database. These consumers handle deduplication (agents may retry on timeout) and apply any write-time transformations like unit normalization or tag canonicalization.

The time-series database (TSDB) is the heart of the system. This is not a general-purpose database — it is a storage engine optimized for append-heavy, timestamp-indexed, highly compressible numerical data. We will discuss its internals in the next section. The TSDB exposes both a write API (used by the write pipeline) and a read API (used by the query engine).

The query engine translates dashboard queries (expressed in a query language like PromQL, Flux, or a custom DSL) into execution plans that read from the TSDB, aggregate across series and time, and return results. It handles fan-out (querying multiple shards in parallel), caching (for repeated dashboard loads), and query planning optimization (using pre-aggregated rollups when possible).

The alerting engine runs continuously, evaluating configured alert rules against recent data. When thresholds are breached, it triggers notifications through configured channels. The alerting engine must be decoupled from the query path so that a spike in dashboard usage does not delay alert evaluation.

The dashboard and API layer provides the user-facing interface — a web application where engineers build dashboards, configure alerts, and explore metrics. This layer is a standard web application backed by a metadata store (PostgreSQL or similar) for dashboard definitions, alert rules, and user preferences.

```
                         METRICS AND MONITORING SYSTEM ARCHITECTURE

  +----------+    +----------+    +----------+
  |  Host A  |    |  Host B  |    |  Host C  |    ... (10,000+ hosts)
  |  Agent   |    |  Agent   |    |  Agent   |
  +----+-----+    +----+-----+    +----+-----+
       |               |               |
       +-------+-------+-------+-------+
               |               |
               v               v
     +---------+---------------+---------+
     |      Ingestion Gateway Cluster     |
     |  (Validation, Rate Limiting,       |
     |   Tag Enrichment)                  |
     +---------+-------------------------+
               |
               v
     +---------+-------------------------+
     |          Apache Kafka              |
     |   (Partitioned by metric hash)     |
     |   [Partition 0] [Partition 1] ...  |
     +---------+-------------------------+
               |
               v
     +---------+-------------------------+
     |       Write Pipeline               |
     |  (Batch, Deduplicate, Transform)   |
     +---------+-------------------------+
               |
               v
     +---------+-------------------------+----------+
     |         Time-Series Database (TSDB)           |
     |  +--------+  +--------+  +--------+          |
     |  |Shard 0 |  |Shard 1 |  |Shard 2 |  ...     |
     |  |Recent  |  |Recent  |  |Recent  |          |
     |  |data SSD|  |data SSD|  |data SSD|          |
     |  +--------+  +--------+  +--------+          |
     |                                               |
     |  +------------------------------------------+ |
     |  |  Cold / Archive Storage (S3 / HDD)       | |
     |  |  (Downsampled: 1m, 1h, 1d rollups)       | |
     |  +------------------------------------------+ |
     +--------+------------------+-------------------+
              |                  |
              v                  v
     +--------+------+  +-------+---------+
     |  Query Engine  |  | Alerting Engine |
     | (Aggregation,  |  | (Rule eval,     |
     |  Caching)      |  |  Dedup, Route)  |
     +--------+------+  +-------+---------+
              |                  |
              v                  v
     +--------+------------------+---------+
     |       Dashboard / API Layer          |
     |  (Web UI, Grafana, REST API)         |
     +--------------------------------------+
              |                  |
              v                  v
         Engineers           PagerDuty / Slack / Email
```

This architecture achieves separation of concerns: ingestion, storage, querying, and alerting are all independently scalable. A spike in dashboard traffic does not affect metric ingestion, and a burst of incoming metrics does not slow down alert evaluation (assuming Kafka absorbs the burst). Each layer can be scaled horizontally by adding more instances.

---

### Section 4 — Deep Dive: Time-Series Storage

Understanding why general-purpose databases fail for time-series workloads is the conceptual foundation of this design. Consider what happens if you store metrics in PostgreSQL with a schema like `(timestamp, metric_name, tags, value)`. You would face several crippling problems: B-tree indexes on timestamps become write bottlenecks as the table grows to billions of rows, UPDATE and DELETE operations (needed for data expiration) cause table bloat and vacuum pressure, the row-oriented storage format wastes space because every row redundantly stores the metric name and tags, and the query planner is not optimized for the specific access patterns of time-series data (range scans over timestamps, aggregation over values).

Time-series databases are built on fundamentally different assumptions. Writes are append-only — you never update an old data point. Data is naturally ordered by time. Values within a single series are highly compressible because consecutive timestamps differ by a constant interval and consecutive values change slowly. Reads almost always involve scanning a contiguous time range for a specific set of series. These assumptions enable radical optimizations.

**Series Identifiers and the Inverted Index:**

Every time series is uniquely identified by a metric name plus a set of label key-value pairs. For example, `http_requests_total{method="GET", handler="/api/users", status="200"}` is a distinct series from `http_requests_total{method="POST", handler="/api/users", status="201"}`. The TSDB maintains an inverted index that maps each label value to the set of series IDs that carry that label. When a query asks for `http_requests_total{status="200"}`, the index quickly resolves the matching series IDs without scanning all data. This is conceptually similar to how a search engine indexes documents by terms.

Prometheus uses a memory-mapped inverted index backed by the "postings" format in its TSDB. Each label pair maps to a sorted list of series IDs, and multi-label queries are resolved by intersecting these lists. The index is built per block (a chunk of time, typically 2 hours) and merged at query time.

**Write-Optimized Storage:**

Prometheus organizes data into a "head block" (an in-memory write-ahead structure for recent data) and "persistent blocks" (immutable, compressed chunks on disk for older data). The head block accepts all incoming writes and periodically compacts into a new persistent block. This design ensures writes never contend with reads on the same data structure.

Each persistent block covers a fixed time range (e.g., 2 hours) and contains three components: the chunk files (compressed time-series data), the index file (the inverted index mapping labels to series to chunk positions), and a metadata file (block time range, stats). Blocks are immutable once written, which simplifies concurrency, caching, and garbage collection. Old blocks are deleted wholesale when their time range falls outside the retention window — no row-level deletion required.

**Compression — The Gorilla Algorithm:**

Facebook published the Gorilla paper in 2015, describing a compression scheme that achieves an average of 1.37 bytes per data point (compared to 16 bytes uncompressed for a timestamp + value pair). The key insight is double-delta encoding for timestamps and XOR encoding for values.

For timestamps: instead of storing absolute timestamps, store the delta from the previous timestamp. Since most metrics arrive at regular intervals, the delta is usually constant (e.g., always 10 seconds). So store the delta-of-deltas, which is usually zero and can be encoded in a single bit. For values: consecutive float64 values in a time series tend to be similar (CPU usage at 43.2% followed by 43.1%). XOR-ing consecutive values produces a number with many leading and trailing zeros, which compresses extremely well with a variable-length encoding.

This compression is critical at scale. Without it, 10M time series at 10-second resolution would require approximately 1.4 TB/day of raw storage. With Gorilla compression, this drops to approximately 120-170 GB/day.

**InfluxDB's Time-Structured Merge Tree (TSM):**

InfluxDB uses a variant of the log-structured merge tree (LSM-tree) called TSM. Incoming writes go to an in-memory cache (analogous to a memtable) and a write-ahead log for durability. When the cache fills, it is flushed to a TSM file on disk — a sorted, compressed, columnar file organized by series key and time. Background compaction merges multiple small TSM files into larger ones, eliminating duplicates and improving read efficiency. InfluxDB's Time Series Index (TSI) solves the high-cardinality problem by moving the series index from an in-memory hash map to a disk-based, memory-mapped structure that can handle hundreds of millions of unique series without exhausting RAM.

**Downsampling and Rollups:**

Raw 10-second resolution data is essential for debugging recent incidents but wasteful for historical analysis. Monitoring systems implement automatic downsampling: after a configurable period, raw data is aggregated into coarser rollups. A common policy is to keep raw data for 7 days, 1-minute rollups for 30 days, 1-hour rollups for 1 year, and 1-day rollups indefinitely. Each rollup typically stores multiple aggregates (min, max, sum, count, average) so that different query types remain accurate. This is a one-way transformation — once raw data is discarded, you cannot reconstruct exact percentiles from the rollups, which is a trade-off that must be communicated to users.

---

### Section 5 — Ingestion Pipeline

The ingestion pipeline is the front door of the monitoring system, and its reliability directly determines whether the system can be trusted. If metrics are lost during ingestion, dashboards will show gaps and alerts will misfire. Designing this pipeline for extreme throughput and resilience is a core challenge.

**Agent-Based Collection: Pull vs Push:**

The first design decision is whether agents push metrics to a central collector or the central system pulls metrics from agents. Prometheus famously uses a pull model: the Prometheus server periodically scrapes HTTP endpoints exposed by targets. This has elegant properties — the server controls the collection rate, it knows immediately when a target is unreachable (a failed scrape is itself a signal), and targets do not need to know the address of the monitoring server. However, pull has significant drawbacks at scale: the central server must maintain a list of all targets (service discovery), scraping thousands of targets creates O(N) outbound connections, and pull does not work well for short-lived processes (batch jobs, serverless functions) that might complete before being scraped.

Datadog, StatsD, and most commercial monitoring systems use a push model: agents running on hosts actively send metrics to the ingestion tier. Push naturally handles ephemeral workloads (the process pushes its metrics before exiting), scales more linearly (each agent independently sends data), and works better across network boundaries (agents can push through firewalls that might block inbound scrape requests). The trade-off is that push requires the ingestion tier to handle backpressure — if agents push faster than the system can absorb, data must be buffered or dropped.

In practice, modern monitoring systems support both models. OpenTelemetry, the emerging industry standard for telemetry collection, supports push-based export with a pull-compatible scrape endpoint, offering maximum flexibility.

**Protocols and Formats:**

Agents speak various protocols depending on the metric source. StatsD (created by Etsy in 2011) uses a simple UDP-based protocol: `metric.name:value|type|@sample_rate|#tag1:value1,tag2:value2`. UDP is fire-and-forget with no connection overhead, making it ideal for high-frequency application-level metrics, but it offers no delivery guarantee. For infrastructure metrics where reliability matters more, agents typically use HTTP or gRPC with protobuf serialization, which provides compression, connection multiplexing, and acknowledgment semantics.

OpenTelemetry's OTLP (OpenTelemetry Protocol) is rapidly becoming the standard wire format. It uses protobuf over gRPC or HTTP, supports metrics, traces, and logs in a unified schema, and includes built-in batching and retry semantics. Designing the ingestion gateway to accept OTLP natively is a strong interview answer because it demonstrates awareness of industry direction.

**Kafka as Ingestion Buffer:**

Between the ingestion gateway and the storage layer, Kafka serves as a critical decoupling buffer. Each incoming metric payload is validated, normalized, and published to a Kafka topic. The topic is partitioned by a hash of the metric series identity (metric name + sorted tags), ensuring that all data points for the same time series are processed in order by the same consumer. This partitioning is essential for the write pipeline to efficiently batch writes to the TSDB — if data for series X arrived at random consumers, each consumer would need to maintain write buffers for all series, which would be memory-prohibitive.

Kafka provides several essential guarantees: durability (data is replicated across brokers before acknowledgment), ordering (within a partition), replay (if a consumer crashes mid-processing, it can rewind and reprocess), and backpressure (producers will slow down or get errors if brokers are overwhelmed, rather than silently dropping data). The retention period on Kafka topics is typically set to 24-72 hours — enough to survive a prolonged TSDB outage and replay once it recovers.

**Batching, Compression, and Backpressure:**

Agents batch metric data points and compress payloads (typically with gzip or zstd) before sending. A well-tuned agent might buffer 10 seconds of data and send it in a single compressed HTTP request rather than making individual requests per data point. This reduces network round-trips by orders of magnitude and improves ingestion gateway throughput.

Backpressure handling is crucial. If the ingestion gateway cannot keep up (perhaps Kafka brokers are temporarily slow), it must signal agents to slow down rather than accepting and silently dropping data. HTTP 429 (Too Many Requests) with a Retry-After header is the standard mechanism. Agents should implement exponential backoff with jitter and local disk buffering for transient failures. In the worst case — a prolonged outage of the ingestion tier — agents should prioritize the most recent data and discard the oldest buffered data, since stale metrics have diminishing value.

**Data Validation and Enrichment:**

The ingestion gateway performs several transformations before writing to Kafka. It validates metric names against a naming convention (rejecting strings with invalid characters or excessive length). It enforces tag cardinality limits — a common production incident is a developer accidentally using a high-cardinality value like a user ID or request ID as a tag, creating millions of unique time series that overwhelm the TSDB. The gateway should reject or truncate tags that would push the cardinality beyond a configurable threshold per metric name. It also enriches data points with metadata from service discovery: if the agent reports only its IP address, the gateway resolves this to a hostname, region, availability zone, and cluster name by consulting a metadata service.

---

### Section 6 — Query Engine

The query engine transforms human-readable queries into efficient execution plans that read from potentially petabytes of time-series data and return results in under a second. This is where the monitoring system's usability is determined — a system that ingests flawlessly but queries slowly is useless during an incident.

**Query Languages:**

Prometheus introduced PromQL, a functional query language designed specifically for time-series data. A typical PromQL query looks like: `rate(http_requests_total{service="checkout", status=~"5.."}[5m])` — this calculates the per-second rate of HTTP 5xx errors for the checkout service over a 5-minute window. PromQL supports aggregation operators (`sum`, `avg`, `quantile`, `topk`), binary operators (arithmetic and comparison between series), and functions (`rate`, `increase`, `histogram_quantile`, `predict_linear`). The language is powerful but has a learning curve, and its design choices (like instant vs range vectors) can confuse newcomers.

InfluxDB developed Flux, a more general-purpose data scripting language that pipelines transformations: `from(bucket:"metrics") |> range(start:-1h) |> filter(fn: (r) => r._measurement == "cpu" and r.host == "server01") |> aggregateWindow(every: 1m, fn: mean)`. Flux is more verbose but more expressive, supporting joins, custom functions, and output to external systems.

For a system design interview, proposing a query language that supports the following primitives is sufficient: select series by metric name and tag filters, specify a time range, apply an aggregation function (sum, avg, min, max, count, percentile) over a time window, and group results by one or more tag keys. The exact syntax is less important than demonstrating you understand the underlying operations.

**Query Execution:**

When a query arrives, the query engine parses it into an abstract syntax tree (AST), then creates an execution plan. The plan identifies which time series match the label selectors (using the inverted index), which time range to scan, and which aggregation to apply. In a distributed TSDB, the matching series may span multiple shards. The query engine performs a fan-out: it sends sub-queries to each relevant shard in parallel, each shard performs its local scan and partial aggregation, and the query engine merges the partial results into the final answer.

For example, `sum(http_requests_total{status="200"}) by (service)` over the last hour might fan out to 16 shards. Each shard returns a partial sum grouped by service for the series it owns. The query engine combines these partial sums (sum is decomposable — the global sum is the sum of the partial sums). For non-decomposable aggregations like percentiles, each shard must return the raw data points or a sketch (like a t-digest), and the query engine merges the sketches. This is more expensive and is a key reason why percentile queries are slower than sum/count queries.

**Query Optimization:**

Several techniques keep query latency low. Pre-aggregated rollups are the most impactful: if a query asks for 1-hour average CPU over the last 30 days, the query engine reads from the 1-hour rollup table (which has 720 data points per series) rather than the raw 10-second resolution table (which has 259,200 data points per series). The query planner automatically selects the finest resolution rollup that satisfies the requested time range and step.

Query result caching stores recent query results keyed by the query string and time range. Since dashboards auto-refresh, the same query is executed repeatedly with a slightly shifted time window. A smart cache can serve the overlapping portion from cache and fetch only the new data. Materialized views for popular queries (like cluster-wide request rates) can be precomputed and stored, eliminating repeated computation.

**High-Cardinality Queries:**

High cardinality — queries that match a very large number of distinct time series — is the single most common performance problem in monitoring systems. A query like `sum(http_requests_total) by (user_id)` with millions of unique user IDs will attempt to load millions of series into memory, overwhelm the query engine, and potentially OOM the process. Defenses include cardinality limits at query time (rejecting queries that would match more than a configurable number of series), query timeouts, query cost estimation before execution, and UI warnings that nudge users toward more specific label filters.

---

### Section 7 — Alerting System

The alerting engine is arguably the most operationally critical component of a monitoring system. Dashboards are viewed when engineers choose to look at them; alerts are the system reaching out to engineers when something demands attention. A missed alert can mean an outage goes undetected; a false alert can cause alert fatigue that leads engineers to ignore real problems. Getting alerting right is both a technical and a human challenge.

**Alert Rule Evaluation:**

An alert rule consists of a query, a condition, and a duration. For example: "Alert CRITICAL if `avg(cpu.utilization{service=checkout}) > 90` for 5 minutes." The alerting engine must continuously evaluate this rule — typically every 15-60 seconds — by executing the query against recent data and checking whether the condition has been met for the specified duration. The duration clause (also called the "for" clause in Prometheus) prevents transient spikes from triggering alerts. The system must track state per alert rule: INACTIVE (condition not met), PENDING (condition met but duration not yet elapsed), and FIRING (condition met for the full duration).

At scale, the alerting engine evaluates millions of rules. Naively executing each rule as an independent query is wasteful — many rules query the same metrics with different thresholds. Optimization strategies include grouping rules by their query expression and evaluating the query once for multiple thresholds, pre-computing commonly referenced expressions and sharing results across rules, and batching rule evaluation into scheduled rounds (every 15 seconds) rather than evaluating each rule on its own timer.

The alerting engine must run on a separate resource pool from the query engine. Dashboard users should not be able to starve the alerting engine of CPU or memory, and vice versa. In a distributed deployment, alert rules are partitioned across multiple evaluator instances using consistent hashing, with a failover mechanism (if an evaluator dies, its rules are redistributed to surviving evaluators within seconds).

**Anomaly Detection:**

Threshold-based alerts are simple but require manual tuning — the right threshold for CPU usage differs between a batch processing server and a web server, and it changes as traffic patterns evolve. Advanced monitoring systems supplement thresholds with anomaly detection algorithms that learn the normal baseline for a metric and alert when the observed value deviates significantly. Common approaches include seasonal decomposition (the metric normally has daily and weekly cycles — detect when it departs from the expected pattern), moving average with standard deviation bands, and machine learning models trained on historical data per metric.

Anomaly detection is powerful but comes with a higher false-positive rate than well-tuned thresholds, so it is typically offered as a complement rather than a replacement. Datadog, for example, provides anomaly detection as an optional alert type alongside threshold, change, and outlier alerts.

**Alert Routing, Grouping, and Suppression:**

When an alert fires, the notification must reach the right person through the right channel. The routing engine uses a rule hierarchy: alerts tagged with `severity=critical` and `team=payments` go to the payments team's PagerDuty rotation, while `severity=warning` alerts go to a Slack channel. This routing configuration is itself a tree of matchers, similar to how Alertmanager in the Prometheus ecosystem handles routing.

Alert grouping prevents notification storms. If a network switch fails and 200 hosts become unreachable, the system should not send 200 separate alerts. Instead, it groups alerts that share a common cause (same time window, same failure domain) and sends a single notification: "200 hosts unreachable in us-east-1a." Deduplication ensures that a continuously firing alert does not send repeated notifications — after the initial notification, subsequent evaluations that find the alert still firing are silently recorded.

Alert suppression (also called silencing or inhibition) allows engineers to mute known conditions. During a planned maintenance window, the on-call engineer can create a silence rule that suppresses all alerts matching `host=db-primary-01` for the next 2 hours. Inhibition rules automatically suppress downstream alerts when a root-cause alert is firing — if the "host unreachable" alert is firing, suppress all service-level alerts from that host because they are consequences, not independent problems.

---

### Section 8 — Scaling and Retention

A monitoring system must scale in three dimensions simultaneously: the number of unique time series (cardinality), the rate of incoming data points (throughput), and the total volume of historical data (retention). Each dimension requires different strategies.

**Horizontal Sharding:**

The TSDB is sharded to distribute both write and read load. The two primary sharding strategies are hash-based (shard by a hash of the series identifier) and time-based (shard by time range). Hash-based sharding distributes series evenly across shards and ensures all data for a given series is co-located, making single-series queries efficient. However, queries that span many series (like `sum(cpu) by (region)`) must fan out to all shards. Time-based sharding puts all data for a given time range on the same shard, making time-range queries efficient, but a single shard handles all writes for the current time window, creating a hotspot.

In practice, most production systems use a hybrid approach: primary sharding by series hash (for write distribution) with secondary partitioning by time (for efficient retention and compaction). Cortex, Thanos, and Mimir — three open-source projects that scale Prometheus horizontally — all use this hybrid approach with different implementation details.

**Replication:**

Each shard is replicated (typically 3x) across independent hosts or availability zones. Writes are sent to all replicas simultaneously (write-all, read-quorum), or a Raft/Paxos consensus protocol is used for strong consistency. For monitoring data, eventual consistency is usually acceptable — it is fine if a metric point written 2 seconds ago is not yet visible in a dashboard query. This relaxation allows simpler replication strategies and higher write throughput.

**Compaction and Downsampling:**

Background compaction processes continuously merge small data blocks into larger ones, improving read efficiency (fewer files to open per query) and reclaiming space from deleted or overwritten data. Downsampling is performed as a separate background job that reads high-resolution data, computes aggregate values (min, max, sum, count) over larger time windows, and writes the results to a rollup table. The original high-resolution data is then eligible for deletion based on retention policy.

A typical retention configuration looks like this: raw resolution (10-second intervals) retained for 15 days on SSD storage, 1-minute rollups retained for 90 days on SSD, 1-hour rollups retained for 2 years on HDD or object storage (S3), and 1-day rollups retained for 5+ years on object storage. The query engine transparently selects the appropriate resolution based on the requested time range — a query over the last hour uses raw data, a query over the last month uses 1-minute rollups, and a query over the last year uses 1-hour rollups.

**Tiered Storage:**

Recent data (the last few hours to days) is "hot" — it is queried frequently for dashboards and alerting, and it must be on fast storage (NVMe SSD). Older data is "warm" (queried occasionally for incident postmortems or capacity planning) and can live on cheaper SSD or HDD. Archive data (months to years old) is "cold" (queried rarely for year-over-year analysis) and belongs in object storage like S3, where cost per GB is cents per month. The storage engine must support transparent tiering — as data ages, it is automatically migrated from hot to warm to cold storage, and the query engine knows how to read from all tiers.

**Multi-Tenancy:**

In a SaaS monitoring product like Datadog, multiple customers share the same infrastructure. Isolation is critical both for security (tenant A must not see tenant B's data) and for fairness (tenant A's spike in cardinality must not degrade tenant B's query performance). Multi-tenancy is typically implemented by prefixing all metric names and series identifiers with a tenant ID, using per-tenant rate limits at the ingestion gateway, allocating per-tenant resource quotas in the query engine, and physically separating large tenants onto dedicated shard groups when their volume warrants it.

---

### Section 9 — Trade-Offs and Design Decisions

Every design decision in a monitoring system involves trade-offs that interviewers expect you to articulate explicitly. Being able to explain not just what you chose but why, and what you gave up, is what separates a strong answer from a mediocre one.

**Push vs Pull Collection:**

Push (agents send data to the server) offers better support for ephemeral workloads, simpler network topology (agents initiate outbound connections), and natural load distribution (each agent independently sends at its own cadence). Pull (server scrapes agents) offers built-in liveness detection (a failed scrape means the target is down), central control of collection rate, and simpler agent implementation (agents just expose an HTTP endpoint). Prometheus chose pull for philosophical reasons — the monitoring server should be authoritative about what it monitors. Datadog chose push for practical reasons — SaaS products cannot reach into customer networks to pull. In interviews, acknowledge both approaches and justify your choice based on the specific constraints (SaaS vs self-hosted, ephemeral vs long-lived workloads, network topology).

**Resolution vs Storage Cost:**

Higher resolution (1-second intervals) gives more precise visibility but costs 10x more storage than 10-second intervals. For most infrastructure metrics, 10-15 second resolution provides sufficient granularity. For application-level metrics (request latency, error rates), 1-second resolution may be valuable during incidents. A pragmatic design allows different metrics to have different collection intervals and documents the storage cost implications for users.

**Pre-Aggregation vs Raw Storage:**

Pre-aggregating at write time (computing sum, count, and average as data arrives) reduces query-time computation but loses information — you cannot compute exact percentiles from pre-aggregated sums and counts. Storing raw data points preserves full fidelity but makes queries more expensive. The optimal approach is to store raw data for a short window (enabling precise queries during incident investigation) and pre-aggregate into rollups for longer-term storage (where approximate answers are acceptable).

**SQL vs Custom Query Language:**

Using SQL would lower the learning curve (most engineers know SQL) and enable leveraging existing SQL engines. However, SQL was designed for relational data and lacks native constructs for time-series operations like rate calculation, range vector aggregation, and label manipulation. Custom query languages (PromQL, Flux) are more concise and expressive for monitoring use cases but require users to learn a new syntax. TimescaleDB's approach — extending PostgreSQL with time-series functions while keeping SQL as the base language — is an interesting middle ground.

**Single-Node vs Distributed TSDB:**

A single Prometheus server can handle approximately 10 million samples per second and store hundreds of millions of time series. For many organizations, this is sufficient. Going distributed adds complexity (shard management, cross-shard queries, consistency protocols) but removes the ceiling on scalability. In an interview, start with a single-node design for clarity, then explain how you would distribute it when scale demands it. Mention specific projects like Thanos (adds long-term storage and global query view to Prometheus), Cortex/Mimir (provides a fully distributed, multi-tenant Prometheus-compatible TSDB), or VictoriaMetrics (a high-performance alternative with built-in clustering).

**Prometheus vs InfluxDB vs Custom:**

Prometheus excels for Kubernetes-native, pull-based monitoring with a powerful query language. InfluxDB excels for push-based workloads, IoT data, and scenarios needing SQL-like querying. A custom TSDB (what Datadog and many large-scale operators build) offers maximum control over performance tuning, storage format, and multi-tenancy but requires a significant engineering investment. Recommend Prometheus for cloud-native environments with fewer than 100 million active series, InfluxDB for mixed workloads with strong write requirements, and a custom solution only when operating at Datadog-scale (trillions of data points per day) where off-the-shelf solutions hit fundamental limitations.

---

### Section 10 — Interview Questions

**Beginner Tier:**

**Q1: What is a time-series database, and why can't you just use PostgreSQL for metrics?**

A time-series database is a storage engine optimized for timestamped numerical data that arrives in append-only fashion and is queried by time range. PostgreSQL struggles with time-series workloads for several reasons. B-tree indexes on timestamp columns become write bottlenecks as the table grows to billions of rows because each insert requires traversing and potentially rebalancing the tree. Row-oriented storage means each row carries redundant copies of the metric name and tags, wasting disk space and memory. Data expiration (deleting rows older than 30 days) triggers expensive vacuum operations. General-purpose query planners cannot exploit the specific patterns of time-series queries (sequential time-range scans, constant-interval timestamps, slowly-changing values). A purpose-built TSDB uses append-only columnar storage, specialized compression (like the Gorilla algorithm that achieves 12x compression), time-partitioned data blocks that can be dropped wholesale for expiration, and inverted indexes on labels for fast series lookup.

**Q2: Explain the difference between push-based and pull-based metric collection.**

In push-based collection, each monitored service or agent actively sends its metrics to a central collector. In pull-based collection, the monitoring server periodically fetches metrics from endpoints exposed by each service. Push is better for short-lived processes (they can push before exiting), works naturally across firewalls (outbound connections from agents), and distributes collection load (each agent sends independently). Pull gives the server control over collection frequency, provides automatic liveness detection (a failed scrape indicates the target is down), and simplifies agent logic (just expose an endpoint). Prometheus uses pull; Datadog, StatsD, and most commercial systems use push. OpenTelemetry supports both. The choice depends on network topology, workload ephemerality, and operational model.

**Q3: Why is Kafka used in the ingestion pipeline?**

Kafka serves as a durable, ordered, high-throughput buffer between the ingestion gateway and the time-series database. It decouples ingestion rate from storage write rate — if the TSDB temporarily slows down (due to compaction, a node restart, or a traffic spike), Kafka absorbs the incoming data without dropping it. Kafka provides durability through replication (data survives broker failures), ordering within partitions (essential for correct time-series writes), and replay capability (if a consumer crashes mid-processing, it can rewind its offset and reprocess without data loss). Partitioning by metric series hash ensures that all data points for a given time series are processed by the same consumer, enabling efficient batching.

**Mid Tier:**

**Q4: How would you handle the high-cardinality problem in a metrics system?**

High cardinality occurs when a metric has a label with many unique values (like user ID or request ID), creating millions of distinct time series. This overwhelms both storage (each series requires index entries and separate data chunks) and queries (aggregating across millions of series is computationally expensive). Defenses operate at multiple levels. At ingestion, enforce per-metric cardinality limits — if a metric exceeds a threshold (e.g., 100,000 unique label combinations), reject new label values and emit a warning to the metric owner. At the agent level, provide guidelines and linting tools that flag high-cardinality labels before deployment. At query time, set maximum series limits per query and abort queries that would scan more series than the limit. In the TSDB, use disk-based indexes (like InfluxDB's TSI) instead of in-memory indexes so that high cardinality does not cause out-of-memory conditions. Finally, educate users: tags should represent bounded dimensions (region, service, status code) not unbounded ones (user ID, trace ID).

**Q5: Design a downsampling strategy for a metrics system that retains data for 5 years.**

The strategy has multiple tiers with decreasing resolution and increasing aggregation. Raw data (10-second intervals) is retained for 15 days — this supports real-time dashboards and detailed incident investigation. A background job runs continuously, reading raw data older than 15 days and computing 1-minute rollups. Each rollup stores five aggregates: min, max, sum, count, and the last value. These 1-minute rollups are retained for 90 days. Another job reads 1-minute rollups older than 90 days and produces 1-hour rollups (same five aggregates), retained for 2 years. Finally, 1-hour rollups older than 2 years are downsampled to 1-day rollups, retained indefinitely (or for 5+ years). Each tier lives on progressively cheaper storage: raw on NVMe SSD, 1-minute on standard SSD, 1-hour on HDD, and 1-day on object storage (S3). The query engine automatically selects the appropriate tier based on the query's time range and step interval. The key trade-off is that percentile calculations become approximate after downsampling — you can compute avg from sum/count, but exact p99 requires the raw distribution, which is why some systems store histogram sketches in their rollups instead of just the five basic aggregates.

**Q6: How do you prevent alert storms when a widespread failure occurs?**

Alert storms happen when a single root cause (like a network partition or a shared dependency failure) triggers hundreds of independent alerts simultaneously, overwhelming the on-call engineer with noise. Several mechanisms prevent this. Alert grouping aggregates related alerts into a single notification — alerts that share the same labels (like the same availability zone or the same downstream dependency) within a short time window are grouped and sent as one message showing the count and common attributes. Alert inhibition defines relationships between alerts: if a "host unreachable" alert is firing, automatically suppress all application-level alerts from that host, since they are symptoms, not independent problems. Rate limiting caps the number of notifications sent per channel per time window — even if 500 alerts fire, the system sends at most one notification per minute per team. Correlation engines identify common failure domains by analyzing which alerts co-occur and suggest likely root causes. Finally, well-designed alert rules avoid alerting on symptoms that are expected during known failure modes — for example, do not alert on individual request errors if the overall error rate is within acceptable bounds.

**Senior Tier:**

**Q7: How would you design a globally distributed monitoring system that must handle 50 million metrics per second across 5 regions with sub-second query latency?**

The core challenge is that metrics are generated in all regions but users expect to query them from any region with consistent sub-second latency. The architecture uses regional ingestion and storage with a global query federation layer. Each region runs an independent ingestion pipeline and TSDB cluster that handles all metrics from that region's services. For queries scoped to a single region (the common case during incident debugging), the local TSDB responds directly. For global queries (like aggregate error rates across all regions for a C-suite dashboard), a federation query engine fans out sub-queries to each region's query engine in parallel, collects partial results, and merges them. To keep cross-region query latency low, each region asynchronously replicates its downsampled rollups (1-minute and coarser) to a global data lake (e.g., S3 with cross-region replication). Global queries for time ranges older than 15 minutes read from this shared rollup store, avoiding cross-region fan-out entirely. For alerting, each region evaluates alerts on its own data independently, and a global alert deduplication layer prevents duplicate notifications when the same metric is observed from multiple regions. The 50M metrics/second is distributed as approximately 10M per region, which a well-provisioned regional cluster of 50-100 storage nodes can handle. Total storage nodes globally: 250-500, plus Kafka clusters, query engines, and alert evaluators in each region.

**Q8: Explain how you would implement an efficient percentile calculation for a metric with 10 million unique time series, each with 10-second resolution, queried over a 1-hour window.**

This is a hard problem because exact percentile calculation requires sorting all values, which at this scale means sorting 10M series x 360 points = 3.6 billion data points. The practical approach uses approximation. At write time, or as a pre-aggregation step, compute t-digest or DDSketch data structures for each series over configurable time windows (e.g., 1-minute and 1-hour windows). A t-digest is a compact data structure (typically 1-3 KB) that provides accurate percentile estimates — it maintains a set of centroids that cluster more densely near the tails of the distribution, giving better accuracy for p99 and p99.9 than for p50. At query time, to compute p99 of `request_latency` across all 10M series for the last hour, read the 60 one-minute t-digests for each of the 10M series (or use the pre-aggregated 1-hour digests if available). T-digests are mergeable — you can combine multiple digests into one that represents the combined distribution. Merge all the digests and then query the combined digest for the desired percentile. The memory footprint is approximately 10M x 3 KB = 30 GB if processing all series in one shot, so the query engine processes them in streaming fashion: merge digests in batches of 10,000 series, then merge the batch results together. The total query involves reading approximately 10M x 1KB (compressed digests) = 10 GB of data from the TSDB, which is feasible from SSD in a few seconds if parallelized across 50-100 shard nodes. To bring it under 1 second, pre-aggregate digests at the tag level (e.g., per-service, per-region) so that the query reads thousands of pre-aggregated digests instead of millions of individual ones.

**Q9: A customer reports that their dashboards load slowly (5+ seconds) despite the TSDB cluster being healthy. Walk through your debugging and optimization process.**

Start by identifying the specific queries that are slow. Examine the query engine's query log, looking for queries with high execution time. Common root causes include high-cardinality queries (the query matches too many series — check the query's series count), missing rollups (the query requests a 30-day time range at raw resolution because the rollup job has fallen behind), cross-shard fan-out inefficiency (the query touches data on many shards and the merge phase is bottlenecked), cache misses (the customer recently changed their dashboard, invalidating the query cache), or network latency (the dashboard frontend is in a different region from the query engine).

For high-cardinality queries: check if the customer is using labels with unbounded cardinality. Work with them to add more specific filters or restructure their metrics. For missing rollups: check the downsampling job's lag metrics — if it has fallen behind, the query engine is forced to read raw data for time ranges that should be served from rollups. Prioritize catching up the rollup job. For fan-out inefficiency: check if the shard distribution is skewed — one shard might hold a disproportionate share of the queried series due to hash collisions. Rebalance shards if needed. For cache misses: enable query result caching with appropriate TTLs. For cross-region latency: deploy a read replica of the TSDB closer to the customer's users or enable CDN caching for dashboard API responses. Finally, check the query itself — sometimes a small query rewrite (adding a tag filter, reducing the time range, or increasing the step interval) can reduce the scanned data by 10-100x.

---

### Section 11 — Complete Code Example

Below is a comprehensive implementation of a simplified metrics monitoring system. We first present the core logic in pseudocode, then provide a working Node.js implementation with line-by-line explanations.

**Pseudocode: Core Monitoring System**

```
// ============================================================
// PSEUDOCODE: Metrics and Monitoring System
// ============================================================

// --- Data Structures ---

STRUCTURE DataPoint:
    metric_name: STRING          // e.g., "http.request.duration"
    tags: MAP<STRING, STRING>    // e.g., {"service": "checkout", "region": "us-east-1"}
    timestamp: INTEGER           // Unix epoch in seconds
    value: FLOAT                 // The metric value

STRUCTURE TimeSeries:
    series_id: STRING            // Hash of metric_name + sorted tags
    metric_name: STRING
    tags: MAP<STRING, STRING>
    data_points: LIST<(timestamp, value)>  // Sorted by timestamp

STRUCTURE AlertRule:
    rule_id: STRING
    query: STRING                // e.g., "avg(cpu.usage{service=web})"
    operator: ENUM(GT, LT, EQ)  // Comparison operator
    threshold: FLOAT             // e.g., 90.0
    duration_seconds: INTEGER    // How long the condition must hold
    state: ENUM(INACTIVE, PENDING, FIRING)
    pending_since: INTEGER       // Timestamp when condition first met
    notification_channels: LIST<STRING>

// --- Ingestion ---

FUNCTION ingest(batch: LIST<DataPoint>):
    FOR EACH point IN batch:
        // Validate
        IF NOT is_valid_metric_name(point.metric_name):
            LOG warning "Invalid metric name: {point.metric_name}"
            CONTINUE

        // Enforce cardinality limit
        series_id = compute_series_id(point.metric_name, point.tags)
        IF cardinality_of(point.metric_name) > MAX_CARDINALITY:
            LOG warning "Cardinality limit exceeded for {point.metric_name}"
            CONTINUE

        // Enrich with metadata
        point.tags["ingested_at"] = CURRENT_TIMESTAMP

        // Write to Kafka buffer
        partition = HASH(series_id) MOD num_partitions
        kafka.publish(topic="metrics", partition=partition, value=serialize(point))

FUNCTION compute_series_id(name: STRING, tags: MAP):
    sorted_tags = SORT tags BY key
    tag_string = JOIN(sorted_tags, ",")  // "key1=val1,key2=val2"
    RETURN SHA256(name + "{" + tag_string + "}")

// --- Time-Series Storage with Compression ---

STRUCTURE CompressedChunk:
    start_time: INTEGER
    timestamps: COMPRESSED_ARRAY  // Delta-of-delta encoded
    values: COMPRESSED_ARRAY      // XOR encoded
    count: INTEGER

FUNCTION compress_chunk(points: LIST<(timestamp, value)>):
    chunk = NEW CompressedChunk
    chunk.start_time = points[0].timestamp
    chunk.count = LENGTH(points)

    // Delta-of-delta encoding for timestamps
    prev_ts = points[0].timestamp
    prev_delta = 0
    FOR i FROM 1 TO LENGTH(points) - 1:
        delta = points[i].timestamp - prev_ts
        delta_of_delta = delta - prev_delta
        WRITE delta_of_delta TO chunk.timestamps  // Variable-length encoding
        prev_delta = delta
        prev_ts = points[i].timestamp

    // XOR encoding for values
    prev_value = FLOAT_TO_BITS(points[0].value)
    FOR i FROM 1 TO LENGTH(points) - 1:
        current = FLOAT_TO_BITS(points[i].value)
        xor_result = prev_value XOR current
        WRITE xor_result TO chunk.values  // Leading/trailing zero optimization
        prev_value = current

    RETURN chunk

// --- Query Engine ---

FUNCTION execute_query(query_string: STRING, start: INTEGER, end: INTEGER, step: INTEGER):
    parsed = parse_query(query_string)  // Returns AST

    // Select appropriate resolution
    resolution = select_resolution(start, end, step)
    // Raw if <15 days, 1min if <90 days, 1hr if <2 years, 1day otherwise

    // Find matching series
    matching_series = inverted_index.lookup(parsed.metric_name, parsed.label_matchers)

    // Fan out to shards
    shard_groups = GROUP matching_series BY shard_id
    partial_results = PARALLEL FOR EACH (shard, series_list) IN shard_groups:
        RETURN shard.query(series_list, start, end, resolution)

    // Merge and aggregate
    merged = merge_results(partial_results)
    aggregated = apply_aggregation(parsed.aggregation_fn, merged, parsed.group_by, step)

    RETURN aggregated

FUNCTION apply_aggregation(fn: STRING, data: MAP<series_id, points>, group_by: LIST<STRING>, step: INTEGER):
    // Group series by the specified tags
    groups = GROUP data BY (series -> extract_tags(series, group_by))

    result = {}
    FOR EACH (group_key, series_list) IN groups:
        aligned_points = align_to_step(series_list, step)
        FOR EACH timestamp IN aligned_points.timestamps:
            values = COLLECT values AT timestamp FROM ALL series IN series_list
            SWITCH fn:
                CASE "sum":   result[group_key][timestamp] = SUM(values)
                CASE "avg":   result[group_key][timestamp] = SUM(values) / COUNT(values)
                CASE "max":   result[group_key][timestamp] = MAX(values)
                CASE "min":   result[group_key][timestamp] = MIN(values)
                CASE "count": result[group_key][timestamp] = COUNT(values)
                CASE "p99":   result[group_key][timestamp] = PERCENTILE(values, 99)

    RETURN result

// --- Alert Evaluation ---

FUNCTION evaluate_alerts():
    // Runs every EVAL_INTERVAL (e.g., 15 seconds)
    FOR EACH rule IN alert_rules:
        current_value = execute_query(rule.query, NOW - rule.duration_seconds, NOW, rule.duration_seconds)
        condition_met = evaluate_condition(current_value, rule.operator, rule.threshold)

        SWITCH rule.state:
            CASE INACTIVE:
                IF condition_met:
                    rule.state = PENDING
                    rule.pending_since = NOW
            CASE PENDING:
                IF NOT condition_met:
                    rule.state = INACTIVE
                    rule.pending_since = NULL
                ELSE IF NOW - rule.pending_since >= rule.duration_seconds:
                    rule.state = FIRING
                    send_notifications(rule)
            CASE FIRING:
                IF NOT condition_met:
                    rule.state = INACTIVE
                    rule.pending_since = NULL
                    send_resolution(rule)
```

**Node.js Implementation: Metrics Monitoring System**

```javascript
// ============================================================
// metrics-monitor.js — Simplified Metrics & Monitoring System
// ============================================================
// This implementation demonstrates the core concepts of a
// metrics monitoring system: ingestion, time-series storage
// with compression, querying with aggregation, and alerting.

const crypto = require('crypto');

// ------------------------------------------------------------
// 1. DATA STRUCTURES
// ------------------------------------------------------------

/**
 * Represents a single metric data point as received from an agent.
 * In production, this would arrive via HTTP/gRPC from a collector agent.
 */
class DataPoint {
  constructor(metricName, tags, timestamp, value) {
    this.metricName = metricName;   // String: the metric identifier
    this.tags = tags;                // Object: key-value label pairs
    this.timestamp = timestamp;      // Number: Unix epoch in seconds
    this.value = value;              // Number: the measured value
  }
}

/**
 * Computes a unique series identifier from metric name and tags.
 * All data points with the same series ID belong to the same time series.
 * Tags are sorted to ensure consistent hashing regardless of insertion order.
 */
function computeSeriesId(metricName, tags) {
  // Sort tag keys alphabetically for deterministic hashing
  const sortedKeys = Object.keys(tags).sort();
  // Build a canonical string: "metric{key1=val1,key2=val2}"
  const tagStr = sortedKeys.map(k => `${k}=${tags[k]}`).join(',');
  const canonical = `${metricName}{${tagStr}}`;
  // SHA-256 hash produces a fixed-length, collision-resistant identifier
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

// ------------------------------------------------------------
// 2. COMPRESSED TIME-SERIES STORAGE
// ------------------------------------------------------------

/**
 * CompressedChunk stores a sequence of (timestamp, value) pairs
 * using delta-of-delta encoding for timestamps and XOR encoding
 * for values, inspired by Facebook's Gorilla paper.
 *
 * In a production TSDB, this would use bitwise operations for
 * variable-length encoding. Here we simulate the compression
 * conceptually while maintaining readability.
 */
class CompressedChunk {
  constructor() {
    this.baseTimestamp = null;      // First timestamp in the chunk
    this.timestamps = [];           // Delta-of-delta encoded timestamps
    this.values = [];               // XOR-encoded values (simplified)
    this.count = 0;                 // Number of data points stored
    this.prevTimestamp = null;      // Previous timestamp for delta calculation
    this.prevDelta = 0;            // Previous delta for delta-of-delta
    this.prevValue = null;          // Previous value for XOR encoding
  }

  /**
   * Appends a new data point to the chunk.
   * Uses delta-of-delta for timestamps: if metrics arrive at regular
   * intervals (e.g., every 10s), the delta-of-delta is 0, which
   * compresses to a single bit in production implementations.
   */
  addPoint(timestamp, value) {
    if (this.count === 0) {
      // First point: store the absolute timestamp and value
      this.baseTimestamp = timestamp;
      this.timestamps.push(timestamp);
      this.values.push(value);
      this.prevTimestamp = timestamp;
      this.prevValue = value;
    } else {
      // Subsequent points: store deltas
      const delta = timestamp - this.prevTimestamp;       // Time difference
      const deltaOfDelta = delta - this.prevDelta;        // Delta of delta
      this.timestamps.push(deltaOfDelta);                 // Usually 0 for regular intervals
      // XOR encoding: store XOR of current and previous value
      // When consecutive values are similar, XOR has many zero bits
      const xorValue = this.xorEncode(this.prevValue, value);
      this.values.push(xorValue);
      this.prevDelta = delta;
      this.prevTimestamp = timestamp;
      this.prevValue = value;
    }
    this.count++;
  }

  /**
   * Simulated XOR encoding. In production, this would operate on
   * the IEEE 754 binary representation of float64 values.
   * Returns a representation that highlights the difference between
   * consecutive values (for actual compression, leading/trailing zeros
   * would be counted and only the meaningful XOR bits stored).
   */
  xorEncode(prev, current) {
    // Simplified: store the difference for demonstration
    // Real implementation: bitwise XOR of float64 representations
    return { diff: current - prev, original: current };
  }

  /**
   * Decompresses the chunk back into an array of (timestamp, value) pairs.
   * Reverses the delta-of-delta and XOR encoding.
   */
  decompress() {
    const result = [];
    if (this.count === 0) return result;

    // Reconstruct first point
    let ts = this.timestamps[0];    // Absolute timestamp
    let val = this.values[0];       // Absolute value
    result.push({ timestamp: ts, value: val });

    let prevDelta = 0;
    // Reconstruct subsequent points by reversing the encoding
    for (let i = 1; i < this.count; i++) {
      const deltaOfDelta = this.timestamps[i];  // Stored delta-of-delta
      prevDelta = prevDelta + deltaOfDelta;      // Recover actual delta
      ts = ts + prevDelta;                        // Recover actual timestamp
      val = this.values[i].original;              // Recover actual value
      result.push({ timestamp: ts, value: val });
    }
    return result;
  }

  /**
   * Returns the compression ratio achieved.
   * Uncompressed: 16 bytes per point (8 for timestamp + 8 for value).
   * Compressed: varies based on regularity of data.
   */
  getCompressionStats() {
    const uncompressedBytes = this.count * 16;
    // Estimate compressed size: first point is 16 bytes,
    // subsequent points average ~2 bytes with Gorilla compression
    const compressedBytes = 16 + (this.count - 1) * 2;
    return {
      points: this.count,
      uncompressedBytes,
      compressedBytes,
      ratio: (uncompressedBytes / compressedBytes).toFixed(2)
    };
  }
}

// ------------------------------------------------------------
// 3. TIME-SERIES DATABASE (IN-MEMORY SIMULATION)
// ------------------------------------------------------------

/**
 * TimeSeriesDB is a simplified in-memory TSDB that stores
 * compressed chunks of time-series data, indexed by series ID.
 * In production, this would be backed by disk storage with
 * memory-mapped files, WAL, and compaction.
 */
class TimeSeriesDB {
  constructor(options = {}) {
    // Map of series_id -> { metadata, chunks: CompressedChunk[] }
    this.series = new Map();
    // Inverted index: tag_key=tag_value -> Set of series_ids
    this.invertedIndex = new Map();
    // Maximum cardinality per metric name
    this.maxCardinalityPerMetric = options.maxCardinality || 100000;
    // Cardinality tracker: metric_name -> count of unique series
    this.cardinalityTracker = new Map();
    // Chunk duration in seconds (how much time each chunk covers)
    this.chunkDuration = options.chunkDuration || 7200; // 2 hours
    // Rollup storage: series_id -> { '1m': [...], '1h': [...], '1d': [...] }
    this.rollups = new Map();
  }

  /**
   * Ingests a batch of data points. Each point is routed to the
   * correct series (creating it if new) and appended to the
   * active chunk. This method also updates the inverted index.
   */
  ingest(dataPoints) {
    const results = { accepted: 0, rejected: 0, errors: [] };

    for (const point of dataPoints) {
      try {
        // Step 1: Validate the metric name
        if (!this.isValidMetricName(point.metricName)) {
          results.rejected++;
          results.errors.push(`Invalid metric name: ${point.metricName}`);
          continue;
        }

        // Step 2: Compute the series identifier
        const seriesId = computeSeriesId(point.metricName, point.tags);

        // Step 3: Check cardinality limits
        const currentCardinality = this.cardinalityTracker.get(point.metricName) || 0;
        if (!this.series.has(seriesId) && currentCardinality >= this.maxCardinalityPerMetric) {
          results.rejected++;
          results.errors.push(`Cardinality limit for ${point.metricName}`);
          continue;
        }

        // Step 4: Create series if it does not exist
        if (!this.series.has(seriesId)) {
          this.series.set(seriesId, {
            metricName: point.metricName,
            tags: { ...point.tags },
            chunks: [new CompressedChunk()]
          });
          // Update cardinality tracker
          this.cardinalityTracker.set(point.metricName, currentCardinality + 1);
          // Update inverted index for each tag
          this.updateInvertedIndex(seriesId, point.metricName, point.tags);
        }

        // Step 5: Append to the active (latest) chunk
        const seriesData = this.series.get(seriesId);
        let activeChunk = seriesData.chunks[seriesData.chunks.length - 1];

        // Start a new chunk if the current one exceeds the duration
        if (activeChunk.count > 0 && point.timestamp - activeChunk.baseTimestamp >= this.chunkDuration) {
          activeChunk = new CompressedChunk();
          seriesData.chunks.push(activeChunk);
        }

        activeChunk.addPoint(point.timestamp, point.value);
        results.accepted++;
      } catch (err) {
        results.rejected++;
        results.errors.push(err.message);
      }
    }

    return results;
  }

  /**
   * Validates metric names. Names must contain only alphanumeric
   * characters, dots, underscores, and hyphens. This prevents
   * injection attacks and ensures clean indexing.
   */
  isValidMetricName(name) {
    return /^[a-zA-Z][a-zA-Z0-9._-]{1,200}$/.test(name);
  }

  /**
   * Updates the inverted index when a new series is created.
   * The index maps each "key=value" pair and the metric name
   * to the set of series IDs that match, enabling fast lookups.
   */
  updateInvertedIndex(seriesId, metricName, tags) {
    // Index by metric name
    const nameKey = `__name__=${metricName}`;
    if (!this.invertedIndex.has(nameKey)) {
      this.invertedIndex.set(nameKey, new Set());
    }
    this.invertedIndex.get(nameKey).add(seriesId);

    // Index by each tag key-value pair
    for (const [key, value] of Object.entries(tags)) {
      const tagKey = `${key}=${value}`;
      if (!this.invertedIndex.has(tagKey)) {
        this.invertedIndex.set(tagKey, new Set());
      }
      this.invertedIndex.get(tagKey).add(seriesId);
    }
  }

  /**
   * Queries the TSDB for data matching the given metric name,
   * tag filters, and time range. Returns raw data points for
   * each matching series.
   *
   * This is the read path — in production, this would fan out
   * to multiple shards and merge results.
   */
  query(metricName, tagFilters = {}, startTime, endTime) {
    // Step 1: Find matching series using the inverted index
    const matchingSeriesIds = this.findMatchingSeries(metricName, tagFilters);

    // Step 2: For each matching series, scan chunks in the time range
    const results = [];
    for (const seriesId of matchingSeriesIds) {
      const seriesData = this.series.get(seriesId);
      if (!seriesData) continue;

      const points = [];
      for (const chunk of seriesData.chunks) {
        // Skip chunks entirely outside the time range
        if (chunk.count === 0) continue;
        const decompressed = chunk.decompress();
        // Filter points within the requested time range
        for (const point of decompressed) {
          if (point.timestamp >= startTime && point.timestamp <= endTime) {
            points.push(point);
          }
        }
      }

      if (points.length > 0) {
        results.push({
          seriesId,
          metricName: seriesData.metricName,
          tags: seriesData.tags,
          points
        });
      }
    }

    return results;
  }

  /**
   * Uses the inverted index to find series matching the given
   * metric name and tag filters. Performs set intersection
   * across all filter criteria.
   */
  findMatchingSeries(metricName, tagFilters) {
    // Start with all series matching the metric name
    const nameKey = `__name__=${metricName}`;
    let candidateSet = this.invertedIndex.get(nameKey);
    if (!candidateSet) return [];

    // Intersect with each tag filter
    let result = new Set(candidateSet);
    for (const [key, value] of Object.entries(tagFilters)) {
      const tagKey = `${key}=${value}`;
      const tagSet = this.invertedIndex.get(tagKey);
      if (!tagSet) return []; // No series match this filter
      // Intersect: keep only series IDs present in both sets
      result = new Set([...result].filter(id => tagSet.has(id)));
    }

    return [...result];
  }

  /**
   * Generates rollups (downsampled data) for a series.
   * Computes min, max, sum, count, and avg for each time bucket.
   */
  generateRollup(seriesId, bucketSizeSeconds) {
    const seriesData = this.series.get(seriesId);
    if (!seriesData) return null;

    // Collect all raw points
    const allPoints = [];
    for (const chunk of seriesData.chunks) {
      allPoints.push(...chunk.decompress());
    }
    allPoints.sort((a, b) => a.timestamp - b.timestamp);

    // Group points into time buckets
    const buckets = new Map();
    for (const point of allPoints) {
      // Floor timestamp to the nearest bucket boundary
      const bucketTs = Math.floor(point.timestamp / bucketSizeSeconds) * bucketSizeSeconds;
      if (!buckets.has(bucketTs)) {
        buckets.set(bucketTs, []);
      }
      buckets.get(bucketTs).push(point.value);
    }

    // Compute aggregates for each bucket
    const rollup = [];
    for (const [ts, values] of buckets) {
      rollup.push({
        timestamp: ts,
        min: Math.min(...values),
        max: Math.max(...values),
        sum: values.reduce((a, b) => a + b, 0),
        count: values.length,
        avg: values.reduce((a, b) => a + b, 0) / values.length
      });
    }

    return rollup.sort((a, b) => a.timestamp - b.timestamp);
  }
}

// ------------------------------------------------------------
// 4. QUERY ENGINE WITH AGGREGATION
// ------------------------------------------------------------

/**
 * QueryEngine provides PromQL-like query capabilities over
 * the TimeSeriesDB. It supports aggregation functions
 * (sum, avg, min, max, count, p99) and GROUP BY operations.
 */
class QueryEngine {
  constructor(tsdb) {
    this.tsdb = tsdb;        // Reference to the time-series database
    this.cache = new Map();  // Simple query result cache
    this.cacheTTL = 15000;   // Cache TTL in milliseconds (15 seconds)
  }

  /**
   * Executes an aggregation query. This is the main entry point
   * for dashboard panels and alert rule evaluation.
   *
   * @param metricName  - The metric to query
   * @param tagFilters  - Label matchers to filter series
   * @param startTime   - Start of the query range (epoch seconds)
   * @param endTime     - End of the query range (epoch seconds)
   * @param aggregation - Aggregation function: 'sum', 'avg', 'min', 'max', 'count', 'p99'
   * @param groupBy     - Array of tag keys to group results by
   * @param step        - Step interval in seconds for result alignment
   */
  executeAggregation(metricName, tagFilters, startTime, endTime, aggregation, groupBy = [], step = 60) {
    // Check cache first
    const cacheKey = JSON.stringify({ metricName, tagFilters, startTime, endTime, aggregation, groupBy, step });
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.cacheTTL) {
      return cached.result;  // Return cached result if still valid
    }

    // Fetch raw data from TSDB
    const rawData = this.tsdb.query(metricName, tagFilters, startTime, endTime);

    // Group series by the specified tags
    const groups = this.groupSeries(rawData, groupBy);

    // For each group, align data points to the step interval and aggregate
    const result = {};
    for (const [groupKey, seriesList] of Object.entries(groups)) {
      result[groupKey] = this.aggregateGroup(seriesList, startTime, endTime, step, aggregation);
    }

    // Cache the result
    this.cache.set(cacheKey, { result, time: Date.now() });
    return result;
  }

  /**
   * Groups an array of series by the specified tag keys.
   * If groupBy is empty, all series are in a single group.
   */
  groupSeries(seriesData, groupBy) {
    const groups = {};
    for (const series of seriesData) {
      let groupKey;
      if (groupBy.length === 0) {
        groupKey = '__all__';  // Single group when no GROUP BY
      } else {
        // Build group key from the specified tags
        groupKey = groupBy.map(k => `${k}=${series.tags[k] || ''}`).join(',');
      }
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(series);
    }
    return groups;
  }

  /**
   * Aggregates multiple series within a group into a single
   * time series by aligning points to a step grid and applying
   * the aggregation function at each step.
   */
  aggregateGroup(seriesList, startTime, endTime, step, aggregation) {
    // Create time-aligned buckets
    const buckets = new Map();
    for (let ts = startTime; ts <= endTime; ts += step) {
      buckets.set(ts, []);
    }

    // Assign each data point to its nearest step bucket
    for (const series of seriesList) {
      for (const point of series.points) {
        const bucketTs = Math.floor(point.timestamp / step) * step;
        if (buckets.has(bucketTs)) {
          buckets.get(bucketTs).push(point.value);
        }
      }
    }

    // Apply the aggregation function to each bucket
    const result = [];
    for (const [ts, values] of buckets) {
      if (values.length === 0) continue;  // Skip empty buckets
      let aggregatedValue;
      switch (aggregation) {
        case 'sum':
          aggregatedValue = values.reduce((a, b) => a + b, 0);
          break;
        case 'avg':
          aggregatedValue = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'min':
          aggregatedValue = Math.min(...values);
          break;
        case 'max':
          aggregatedValue = Math.max(...values);
          break;
        case 'count':
          aggregatedValue = values.length;
          break;
        case 'p99':
          aggregatedValue = this.percentile(values, 99);
          break;
        default:
          throw new Error(`Unknown aggregation: ${aggregation}`);
      }
      result.push({ timestamp: ts, value: Math.round(aggregatedValue * 1000) / 1000 });
    }

    return result;
  }

  /**
   * Calculates the Nth percentile of an array of values.
   * Uses the nearest-rank method. In production, a t-digest
   * or DDSketch would be used for memory-efficient approximate
   * percentile calculation across millions of values.
   */
  percentile(values, n) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((n / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

// ------------------------------------------------------------
// 5. ALERTING ENGINE
// ------------------------------------------------------------

/**
 * AlertEngine evaluates alert rules against the TSDB at regular
 * intervals and triggers notifications when conditions are met.
 * Implements the INACTIVE -> PENDING -> FIRING state machine.
 */
class AlertEngine {
  constructor(queryEngine) {
    this.queryEngine = queryEngine;   // Used to evaluate alert queries
    this.rules = new Map();           // rule_id -> AlertRule
    this.notifications = [];          // Log of sent notifications
    this.evalInterval = 15;           // Evaluation interval in seconds
  }

  /**
   * Registers a new alert rule. The rule specifies a metric query,
   * a threshold condition, and how long the condition must hold
   * before the alert fires (the "for" duration).
   */
  addRule(ruleId, config) {
    this.rules.set(ruleId, {
      id: ruleId,
      metricName: config.metricName,     // Metric to monitor
      tagFilters: config.tagFilters || {},// Label filters
      aggregation: config.aggregation || 'avg',  // How to aggregate matching series
      operator: config.operator,          // 'gt', 'lt', 'eq'
      threshold: config.threshold,        // Numeric threshold
      durationSeconds: config.durationSeconds || 300,  // "for" clause
      state: 'INACTIVE',                 // Current state
      pendingSince: null,                 // When the condition first became true
      channels: config.channels || ['console'],  // Notification channels
      lastValue: null                     // Last evaluated value (for debugging)
    });
  }

  /**
   * Evaluates all alert rules. This method is called periodically
   * (every evalInterval seconds) by a scheduler.
   *
   * For each rule, it executes the query, checks the condition,
   * and transitions the rule through the state machine:
   *   INACTIVE -> PENDING (condition just became true)
   *   PENDING  -> FIRING  (condition held for durationSeconds)
   *   PENDING  -> INACTIVE (condition no longer true)
   *   FIRING   -> INACTIVE (condition resolved)
   */
  evaluateAll(currentTime) {
    const evaluationResults = [];

    for (const [ruleId, rule] of this.rules) {
      // Execute the alert's query over the evaluation window
      const endTime = currentTime;
      const startTime = endTime - rule.durationSeconds;

      const queryResult = this.queryEngine.executeAggregation(
        rule.metricName,
        rule.tagFilters,
        startTime,
        endTime,
        rule.aggregation,
        [],        // No GROUP BY for alert evaluation
        rule.durationSeconds  // Single bucket for the whole duration
      );

      // Extract the aggregated value
      const allGroup = queryResult['__all__'];
      if (!allGroup || allGroup.length === 0) {
        // No data — treat as condition not met
        if (rule.state !== 'INACTIVE') {
          rule.state = 'INACTIVE';
          rule.pendingSince = null;
        }
        evaluationResults.push({ ruleId, state: rule.state, value: null });
        continue;
      }

      // Use the most recent bucket's value
      const currentValue = allGroup[allGroup.length - 1].value;
      rule.lastValue = currentValue;

      // Evaluate the threshold condition
      const conditionMet = this.evaluateCondition(currentValue, rule.operator, rule.threshold);

      // State machine transitions
      const previousState = rule.state;
      switch (rule.state) {
        case 'INACTIVE':
          if (conditionMet) {
            rule.state = 'PENDING';
            rule.pendingSince = currentTime;
          }
          break;

        case 'PENDING':
          if (!conditionMet) {
            // Condition cleared before duration elapsed
            rule.state = 'INACTIVE';
            rule.pendingSince = null;
          } else if (currentTime - rule.pendingSince >= rule.durationSeconds) {
            // Condition held for the full duration — fire the alert
            rule.state = 'FIRING';
            this.sendNotification(rule, currentValue, currentTime);
          }
          break;

        case 'FIRING':
          if (!conditionMet) {
            // Condition resolved
            rule.state = 'INACTIVE';
            rule.pendingSince = null;
            this.sendResolution(rule, currentValue, currentTime);
          }
          break;
      }

      evaluationResults.push({
        ruleId,
        previousState,
        currentState: rule.state,
        value: currentValue,
        conditionMet
      });
    }

    return evaluationResults;
  }

  /**
   * Evaluates a condition against a threshold.
   */
  evaluateCondition(value, operator, threshold) {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'eq': return Math.abs(value - threshold) < 0.001;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      default: return false;
    }
  }

  /**
   * Sends a notification when an alert starts firing.
   * In production, this would integrate with PagerDuty, Slack, etc.
   */
  sendNotification(rule, value, timestamp) {
    const notification = {
      type: 'ALERT',
      ruleId: rule.id,
      metric: rule.metricName,
      value: value,
      threshold: rule.threshold,
      operator: rule.operator,
      channels: rule.channels,
      timestamp: timestamp,
      message: `ALERT [${rule.id}]: ${rule.metricName} is ${value} (${rule.operator} ${rule.threshold})`
    };
    this.notifications.push(notification);
    return notification;
  }

  /**
   * Sends a resolution notification when an alert clears.
   */
  sendResolution(rule, value, timestamp) {
    const notification = {
      type: 'RESOLVED',
      ruleId: rule.id,
      metric: rule.metricName,
      value: value,
      timestamp: timestamp,
      message: `RESOLVED [${rule.id}]: ${rule.metricName} is ${value} (back below ${rule.threshold})`
    };
    this.notifications.push(notification);
    return notification;
  }
}

// ------------------------------------------------------------
// 6. DEMONSTRATION — PUTTING IT ALL TOGETHER
// ------------------------------------------------------------

function runDemo() {
  console.log('=== Metrics & Monitoring System Demo ===\n');

  // Initialize the TSDB with a low cardinality limit for demo purposes
  const tsdb = new TimeSeriesDB({ maxCardinality: 1000, chunkDuration: 3600 });
  const queryEngine = new QueryEngine(tsdb);
  const alertEngine = new AlertEngine(queryEngine);

  // --- Step 1: Simulate metric ingestion from multiple services ---
  console.log('--- Step 1: Ingesting Metrics ---');

  const baseTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
  const dataPoints = [];

  // Simulate CPU metrics from 3 hosts over 1 hour at 10-second intervals
  const hosts = ['web-01', 'web-02', 'web-03'];
  const regions = ['us-east-1', 'us-west-2', 'eu-west-1'];

  for (let i = 0; i < 360; i++) {  // 360 points = 1 hour at 10s intervals
    const timestamp = baseTime + (i * 10);
    for (let h = 0; h < hosts.length; h++) {
      // CPU usage: base load + some variation + a spike in the last 10 minutes
      let cpuValue = 40 + (h * 10) + (Math.random() * 10);
      if (i > 300) cpuValue += 30;  // Spike in the last 10 minutes

      dataPoints.push(new DataPoint(
        'system.cpu.usage',
        { host: hosts[h], region: regions[h], service: 'web' },
        timestamp,
        Math.round(cpuValue * 100) / 100
      ));

      // HTTP request latency
      let latency = 50 + (Math.random() * 30);
      if (i > 300) latency += 200;  // Latency spike

      dataPoints.push(new DataPoint(
        'http.request.latency_ms',
        { host: hosts[h], region: regions[h], service: 'web', endpoint: '/api/checkout' },
        timestamp,
        Math.round(latency * 100) / 100
      ));
    }
  }

  const ingestResult = tsdb.ingest(dataPoints);
  console.log(`  Ingested: ${ingestResult.accepted} accepted, ${ingestResult.rejected} rejected`);
  console.log(`  Total unique series: ${tsdb.series.size}`);
  console.log(`  Inverted index entries: ${tsdb.invertedIndex.size}`);

  // --- Step 2: Demonstrate compression ---
  console.log('\n--- Step 2: Compression Statistics ---');

  for (const [seriesId, seriesData] of tsdb.series) {
    const chunk = seriesData.chunks[0];
    const stats = chunk.getCompressionStats();
    console.log(`  Series: ${seriesData.metricName}{host=${seriesData.tags.host}} ` +
      `| Points: ${stats.points} | Compression ratio: ${stats.ratio}x`);
    break; // Show just one for brevity
  }

  // --- Step 3: Query with aggregation ---
  console.log('\n--- Step 3: Query Examples ---');

  const queryEnd = baseTime + 3600;
  const queryStart = queryEnd - 600;  // Last 10 minutes

  // Query 1: Average CPU across all web hosts
  const avgCpu = queryEngine.executeAggregation(
    'system.cpu.usage',
    { service: 'web' },
    queryStart, queryEnd,
    'avg', [],   // No GROUP BY — aggregate all hosts together
    60           // 1-minute step
  );
  console.log('  Query: avg(system.cpu.usage{service=web}) [last 10 min, 1m step]');
  const allValues = avgCpu['__all__'] || [];
  console.log(`  Results: ${allValues.length} data points`);
  if (allValues.length > 0) {
    console.log(`  First: ${allValues[0].value} at t+${allValues[0].timestamp - baseTime}s`);
    console.log(`  Last:  ${allValues[allValues.length - 1].value} at t+${allValues[allValues.length - 1].timestamp - baseTime}s`);
  }

  // Query 2: Max CPU grouped by host
  const maxCpuByHost = queryEngine.executeAggregation(
    'system.cpu.usage',
    { service: 'web' },
    queryStart, queryEnd,
    'max', ['host'],  // GROUP BY host
    300               // 5-minute step
  );
  console.log('\n  Query: max(system.cpu.usage{service=web}) by (host) [last 10 min, 5m step]');
  for (const [group, points] of Object.entries(maxCpuByHost)) {
    if (points.length > 0) {
      console.log(`  ${group}: max=${points[points.length - 1].value}`);
    }
  }

  // Query 3: P99 latency
  const p99Latency = queryEngine.executeAggregation(
    'http.request.latency_ms',
    { endpoint: '/api/checkout' },
    queryStart, queryEnd,
    'p99', [],
    300
  );
  console.log('\n  Query: p99(http.request.latency_ms{endpoint=/api/checkout}) [last 10 min]');
  const p99Values = p99Latency['__all__'] || [];
  if (p99Values.length > 0) {
    console.log(`  P99 latency: ${p99Values[p99Values.length - 1].value}ms`);
  }

  // --- Step 4: Rollup / Downsampling ---
  console.log('\n--- Step 4: Downsampling Demo ---');

  const firstSeriesId = tsdb.series.keys().next().value;
  const oneMinuteRollup = tsdb.generateRollup(firstSeriesId, 60);
  const fiveMinuteRollup = tsdb.generateRollup(firstSeriesId, 300);

  console.log(`  Raw data points: 360 (10s intervals over 1 hour)`);
  console.log(`  1-minute rollup: ${oneMinuteRollup ? oneMinuteRollup.length : 0} buckets`);
  console.log(`  5-minute rollup: ${fiveMinuteRollup ? fiveMinuteRollup.length : 0} buckets`);
  if (oneMinuteRollup && oneMinuteRollup.length > 0) {
    const sample = oneMinuteRollup[oneMinuteRollup.length - 1];
    console.log(`  Last 1m bucket: avg=${sample.avg.toFixed(2)}, min=${sample.min.toFixed(2)}, max=${sample.max.toFixed(2)}, count=${sample.count}`);
  }

  // --- Step 5: Alerting ---
  console.log('\n--- Step 5: Alert Evaluation ---');

  // Define alert rules
  alertEngine.addRule('high-cpu', {
    metricName: 'system.cpu.usage',
    tagFilters: { service: 'web' },
    aggregation: 'avg',
    operator: 'gt',
    threshold: 70,
    durationSeconds: 300,   // Alert if CPU > 70% for 5 minutes
    channels: ['pagerduty', 'slack']
  });

  alertEngine.addRule('high-latency', {
    metricName: 'http.request.latency_ms',
    tagFilters: { endpoint: '/api/checkout' },
    aggregation: 'p99',
    operator: 'gt',
    threshold: 200,
    durationSeconds: 300,
    channels: ['pagerduty']
  });

  // Simulate multiple evaluation cycles
  console.log('  Evaluating alert rules...');

  // First evaluation — conditions should be detected as true (data has a spike)
  let evalResults = alertEngine.evaluateAll(queryEnd - 60);
  for (const r of evalResults) {
    console.log(`  [t-60s] Rule: ${r.ruleId} | State: ${r.previousState} -> ${r.currentState} | Value: ${r.value} | Condition met: ${r.conditionMet}`);
  }

  // Second evaluation — after the duration has elapsed
  evalResults = alertEngine.evaluateAll(queryEnd + 240);
  for (const r of evalResults) {
    console.log(`  [t+240s] Rule: ${r.ruleId} | State: ${r.previousState} -> ${r.currentState} | Value: ${r.value} | Condition met: ${r.conditionMet}`);
  }

  // Show notifications
  console.log(`\n  Notifications sent: ${alertEngine.notifications.length}`);
  for (const n of alertEngine.notifications) {
    console.log(`  [${n.type}] ${n.message}`);
    console.log(`    Channels: ${n.channels ? n.channels.join(', ') : 'N/A'}`);
  }

  console.log('\n=== Demo Complete ===');
}

// Run the demonstration
runDemo();
```

**Line-by-line explanation of key sections:**

The `computeSeriesId` function (lines in the DataPoint section) creates a deterministic identifier for each time series by sorting tags alphabetically and hashing the concatenation. This ensures that the same metric with the same tags always maps to the same series, regardless of the order in which tags were specified by the agent.

The `CompressedChunk` class implements a simplified version of the Gorilla compression algorithm. The `addPoint` method stores the first data point's timestamp and value directly, then for subsequent points stores only the delta-of-delta for timestamps (which is typically zero for regular-interval metrics) and the XOR difference for values (which is small when consecutive values are similar). The `decompress` method reverses these operations to reconstruct the original data. The `getCompressionStats` method estimates the compression ratio — in production with proper bitwise encoding, this achieves 8-12x compression.

The `TimeSeriesDB.ingest` method processes each data point through a pipeline: validate the metric name, compute the series ID, check cardinality limits, create the series if new (updating both the series store and the inverted index), and append the point to the active chunk. The cardinality check is critical — it prevents a single misbehaving service from creating millions of series that would overwhelm the database.

The `QueryEngine.executeAggregation` method implements the full query path: check the cache, fetch raw data from the TSDB, group series by the specified tags, align data points to the step grid, and apply the aggregation function to each time bucket. The cache prevents redundant computation when dashboards auto-refresh with overlapping time windows.

The `AlertEngine.evaluateAll` method implements the three-state machine (INACTIVE, PENDING, FIRING) that prevents transient spikes from triggering alerts. A condition must be continuously true for the specified duration before transitioning from PENDING to FIRING. When the condition clears, the alert immediately returns to INACTIVE and a resolution notification is sent.

---

### Section 12 — Connection to Next Topic

Designing a metrics and monitoring system teaches you how to observe and understand the behavior of distributed systems — but it raises an inevitable question: what kind of system are you monitoring? The answer increasingly involves a choice between monolithic and microservices architectures, and this choice fundamentally shapes what your monitoring system must handle.

A monolithic application emits metrics from a single process or a small cluster of identical processes. The metric cardinality is manageable (one service, a handful of endpoints), traces are simple (requests stay within one process), and dashboards are straightforward. A microservices architecture, by contrast, explodes the monitoring surface area: hundreds of services, thousands of endpoints, complex request flows that span dozens of services, and cascading failure modes where a slow database in service A causes timeout storms in services B through Z. The monitoring system we designed in this topic must handle this complexity — the high cardinality, the cross-service correlation, the need for distributed tracing alongside metrics.

This is precisely why the next topic, Topic 56: Microservices vs Monolith Architecture, is a natural continuation. Having designed the system that observes applications, we now turn to the fundamental architectural decision that determines how applications are built, deployed, and scaled. You will see how the choice between monolith and microservices affects not just code organization but every aspect of the system you have been building mental models for — deployment pipelines, data consistency, network communication, failure isolation, and yes, monitoring and observability. The skills you developed here — reasoning about high-throughput data pipelines, storage trade-offs, and operational reliability — will directly inform your evaluation of when the complexity of microservices is justified and when a monolith is the right answer.
