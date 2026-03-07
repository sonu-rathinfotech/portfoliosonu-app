# 09 — Real-World Designs Part 1

> From foundational building blocks to production-ready systems — five classic system design problems that test your ability to synthesize concepts from earlier chapters into cohesive, scalable architectures.

---

<!--
Topic: 40
Title: Design a URL Shortener (TinyURL)
Section: 09 — Real-World Designs Part 1
Track: 80/20 Core
Difficulty: beginner-mid
Interview Weight: very-high
Prerequisites: Topics 1-3 (Scalability, Latency, Throughput), 6-10 (Storage, Databases, Indexing, Replication, Sharding), 15-16 (Caching, CDNs), 19-20 (Load Balancing, Rate Limiting)
Next Topic: Topic 41 — Design a Paste Bin
Estimated Read Time: 45-55 minutes
-->

## Topic 40: Design a URL Shortener (TinyURL)

---

### Section 1 — Why This Design?

In 2002, Kevin Gilbertson launched TinyURL to solve a deceptively simple problem: long URLs broke when pasted into emails and forum posts. Line wraps would split a URL in half, rendering the link useless. His solution was elegant — take any URL, no matter how long, and produce a short alias that redirects to the original. What seemed like a weekend project became the blueprint for an entire category of internet infrastructure.

The real explosion came in 2006 when Twitter imposed its 140-character limit on tweets. Suddenly, a URL that consumed 90 characters of your precious limit was unacceptable. Services like bit.ly (founded 2008) and goo.gl (Google, 2009) emerged not just as URL shorteners but as analytics platforms. bit.ly realized that every redirect was a data point — who clicked, from where, when, and how often. URL shortening became the trojan horse for link analytics, and companies began building entire marketing strategies around shortened link data.

If you take only one system design problem into an interview, make it this one. URL shortener appears in an estimated 30-40% of system design rounds across major tech companies. Interviewers love it because it looks simple on the surface — "just map a short string to a long string" — but peeling back the layers reveals questions about distributed ID generation, database sharding, caching strategies, consistency trade-offs, and analytics pipelines. A candidate who merely describes a hash table misses the point entirely. A candidate who discusses collision handling, key generation at scale, cache-aside patterns for hot URLs, and the subtle difference between 301 and 302 redirects demonstrates genuine depth. This problem is a fractal: the deeper you look, the more complexity you find, and that is exactly what makes it the perfect interview question.

What makes this design deceptively deep is that every "obvious" decision has a non-obvious consequence. Use a hash function? You need collision resolution. Use a counter? You need distributed coordination. Cache aggressively? You might serve stale redirects. Store forever? Your database grows without bound. Every path through this design involves a meaningful trade-off, and articulating those trade-offs clearly is what separates a strong answer from a mediocre one.

---

### Section 2 — Requirements Gathering

Before drawing a single box on a whiteboard, you must establish what exactly you are building. In an interview, spending 3-5 minutes on requirements gathering signals maturity and prevents you from solving the wrong problem. Here are the requirements a strong candidate would clarify.

**Functional Requirements:**

The core function is straightforward: given a long URL, produce a short URL that redirects users to the original destination. But "straightforward" quickly branches. Should users be able to specify custom aliases (e.g., `short.ly/my-resume`)? Almost certainly yes — this is a common feature and interviewers expect you to address the namespace collision it introduces. Should URLs expire? Yes — both system-imposed expiration (e.g., free-tier links expire after 2 years) and user-specified expiration (e.g., a link valid only for 24 hours for a flash sale). Should the same long URL always produce the same short URL, or should each request generate a unique short code? This matters for deduplication and storage — most production systems generate a new short code each time, because different users may want different analytics and expiration policies for the same destination URL. Finally, should we track analytics (click count, geographic data, referrer)? For a complete design, yes.

**Non-Functional Requirements:**

Redirects must be fast. Users clicking a short link expect sub-100ms response times; anything slower feels broken. The system must be highly available — a URL shortener that is down means every link it ever produced is dead, which could cascade across millions of web pages, emails, and documents. We need to plan for massive scale. The system should handle billions of stored URLs and sustain heavy read traffic, since URLs are created once but clicked many times. Data durability is non-negotiable; losing the mapping between a short code and its destination means permanent link death. Finally, short codes should be unpredictable — sequential codes leak information about system usage and allow enumeration attacks.

**Back-of-Envelope Estimation:**

Let us ground this design in concrete numbers. Assume we are building a system at the scale of bit.ly or a comparable service.

```
Write volume:
- 100 million new URLs shortened per day
- 100M / 86,400 seconds = ~1,160 writes/second
- Peak: ~3,500 writes/second (3x average)

Read volume (redirects):
- Read:write ratio of 10:1 (conservative; bit.ly reports closer to 20:1)
- 1 billion redirects per day
- 1B / 86,400 = ~11,600 reads/second
- Peak: ~35,000 reads/second

Storage estimation (5-year horizon):
- 100M URLs/day x 365 days x 5 years = 182.5 billion URLs
- Average long URL length: ~200 bytes
- Short code: 7 characters = 7 bytes
- Metadata (timestamps, userId, etc.): ~100 bytes
- Per-record size: ~307 bytes, round to ~500 bytes with overhead
- Total storage: 182.5B x 500 bytes = ~91.25 TB

Short code keyspace:
- Using Base62 (a-z, A-Z, 0-9): 62 characters
- 7-character code: 62^7 = 3.52 trillion possible codes
- At 100M/day for 5 years = 182.5 billion codes used
- Utilization: 182.5B / 3.52T = ~5.2% — plenty of headroom

Bandwidth:
- Incoming (writes): 1,160 req/s x 500 bytes = ~580 KB/s (negligible)
- Outgoing (reads): 11,600 req/s x 500 bytes = ~5.8 MB/s (modest)

Cache memory:
- 80/20 rule: 20% of URLs generate 80% of traffic
- Cache the top 20% of daily URLs
- 20% of 1B daily reads = 200M unique hot URLs (upper bound)
- Realistically, ~10M unique hot URLs per day
- 10M x 500 bytes = ~5 GB cache — fits comfortably in Redis
```

These numbers tell us several things: the system is read-heavy, storage is significant but manageable, the keyspace is ample with 7-character codes, and caching can absorb most read traffic. This shapes every architectural decision that follows.

---

### Section 3 — High-Level Architecture

With requirements established and numbers in hand, let us define the architecture. The system has two primary flows: the **write path** (creating a short URL) and the **read path** (redirecting a short URL to its destination).

**API Design:**

```
POST /api/v1/shorten
  Request body:  { "longUrl": "https://example.com/very/long/path",
                   "customAlias": "my-link",      // optional
                   "expiresAt": "2026-12-31T00:00:00Z" }  // optional
  Response:      { "shortUrl": "https://short.ly/aB3kX9p",
                   "shortCode": "aB3kX9p",
                   "expiresAt": "2026-12-31T00:00:00Z" }

GET /:shortCode
  Response:      HTTP 302 Found
                 Location: https://example.com/very/long/path

GET /api/v1/stats/:shortCode
  Response:      { "totalClicks": 14523,
                   "createdAt": "2026-01-15T10:30:00Z",
                   "clicksByCountry": { "US": 8000, "IN": 3000, ... } }
```

The POST endpoint accepts a long URL and optional parameters, returning a short URL. The GET endpoint on the short code performs the redirect. A separate stats endpoint provides analytics. Notice the API is versioned (`v1`) — a small detail that signals production awareness in an interview.

**High-Level Architecture Diagram:**

```
                         +-------------------+
                         |   Load Balancer   |
                         |  (Nginx / ALB)    |
                         +--------+----------+
                                  |
                    +-------------+-------------+
                    |                           |
            +-------+-------+           +-------+-------+
            |  API Server 1 |           |  API Server N |
            |  (Stateless)  |           |  (Stateless)  |
            +-------+-------+           +-------+-------+
                    |                           |
                    +-------------+-------------+
                                  |
                    +-------------+-------------+
                    |                           |
            +-------+-------+           +-------+-------+
            |  Redis Cache  |           |  Key Generation|
            |  Cluster      |           |  Service (KGS) |
            +-------+-------+           +-------+-------+
                    |                           |
                    +-------------+-------------+
                                  |
                         +--------+----------+
                         |   Database        |
                         |  (NoSQL Cluster)  |
                         |  Sharded by       |
                         |  shortCode        |
                         +--------+----------+
                                  |
                         +--------+----------+
                         |  Analytics Queue  |
                         |  (Kafka)          |
                         +-------------------+
                                  |
                         +--------+----------+
                         |  Analytics Store  |
                         |  (ClickHouse /    |
                         |   time-series DB) |
                         +-------------------+
```

**Write Path (Creating a Short URL):**

When a user submits a long URL, the request hits the load balancer, which routes it to one of the stateless API servers. The server first validates the input (is it a well-formed URL? does the optional custom alias contain only allowed characters?). If a custom alias is requested, the server checks the database to see if it is already taken. If no custom alias is provided, the server obtains a unique short code — either by requesting one from the Key Generation Service or by generating one using a counter-based approach. The server then writes the mapping (shortCode -> longURL + metadata) to the database, optionally populates the cache, and returns the short URL to the user.

**Read Path (Redirecting):**

When a user clicks a short URL, the request arrives at the load balancer and reaches an API server. The server first checks the Redis cache for the shortCode. On a cache hit, it immediately returns a redirect response. On a cache miss, it queries the database, stores the result in the cache for future requests, and then returns the redirect. In parallel (asynchronously), the server publishes a click event to the analytics queue so that click tracking does not add latency to the redirect.

The read path is latency-critical. Every millisecond matters because the user is waiting for a page to load. The write path can tolerate slightly higher latency since the user is performing an explicit action and expects a moment of processing.

---

### Section 4 — Deep Dive: Key Generation

Key generation is the heart of a URL shortener and the section where interviews go deep. The question is simple: how do you generate a unique, short, and opaque string for each new URL? The answer is anything but simple. There are several approaches, each with distinct trade-offs.

**Approach 1: Base62 Encoding of an Auto-Increment Counter**

The most intuitive approach is to maintain a global counter. URL number 1 gets code "1", URL number 1000 gets code "G8" (1000 in Base62), and so on. Base62 uses the characters a-z, A-Z, and 0-9 — 62 symbols total — which means a 7-character string can represent 62^7 = 3.52 trillion unique values. This is simple and guarantees uniqueness without any collision handling.

However, the drawbacks are significant. A single global counter becomes a bottleneck and single point of failure at scale. Sequential codes are predictable — if you know the latest short code is "aB3kX9p", you can guess that "aB3kX9q" also exists, enabling enumeration attacks. To distribute the counter, you could use a Snowflake-like ID generator that combines a timestamp, machine ID, and sequence number into a 64-bit integer, then Base62-encode it. This gives you distributed generation without coordination but produces longer codes (a 64-bit integer in Base62 is 11 characters). You can truncate to 7 characters, but then you need collision checking.

```
Base62 encoding example:
  Input:  1000000000 (counter value)

  1000000000 % 62 = 18  -> 'i'
  16129032   % 62 = 16  -> 'q'
  260145     % 62 = 57  -> '5'  (mapping: 0-9=0-9, a-z=10-35, A-Z=36-61)
  4encyclop  ...

  Result: "1LY7VK" (6 characters for 1 billion)

  7 characters handles up to 3.52 trillion entries.
```

**Approach 2: Hash-Based (MD5 / SHA-256 Truncation)**

Take the long URL, compute its MD5 or SHA-256 hash, then take the first 7 characters of the Base62-encoded hash. This is stateless — any server can independently compute the same hash for the same URL without coordination. But collision risk is real. With a 7-character Base62 code (about 43 bits of entropy), the birthday paradox tells us collisions become likely around sqrt(62^7) = roughly 1.88 million entries. At 100 million URLs per day, you would see collisions within the first day. To handle this, you check the database for the generated code; if it exists, you append a salt or counter and re-hash. This retry loop adds latency and complexity.

```
Collision probability (birthday paradox):
  For n items in a keyspace of size N:
  P(collision) ≈ 1 - e^(-n^2 / (2*N))

  N = 62^7 = 3.52 trillion
  n = 182.5 billion (5 years of URLs)

  P ≈ 1 - e^(-(182.5B)^2 / (2 * 3.52T))
  P ≈ 1 - e^(-4735)
  P ≈ 1.0 (virtually certain over 5 years)

  But per individual insertion with 182.5B existing entries:
  P(single collision) = 182.5B / 3.52T ≈ 5.2%

  At 5.2% collision rate, ~1 in 20 insertions needs a retry.
  Manageable, but adds code complexity.
```

**Approach 3: Pre-Generated Key Service (KGS)**

This is the approach most often recommended in interviews for its elegance. A separate Key Generation Service pre-generates millions of unique short codes ahead of time and stores them in a dedicated database table. When an API server needs a new code, it requests a batch (say, 1000 codes) from the KGS. The KGS marks those codes as "used" and hands them over. The API server keeps the batch in memory and assigns codes from it, requesting a new batch when it runs low.

This approach eliminates runtime collision checking, requires no coordination between API servers (each has its own batch), and decouples key generation from the write path. The KGS itself can be simple — it generates codes sequentially or randomly, inserts them into a table, and serves them in batches. If an API server crashes with unused codes in its batch, those codes are simply lost — at 3.52 trillion possible codes, losing a few thousand is irrelevant.

The main trade-off is added infrastructure complexity. You need to ensure the KGS is highly available (replicated, with failover). You also need to handle the edge case where the KGS is temporarily unavailable — API servers should keep a buffer of pre-fetched codes to ride through brief outages.

```
KGS Database Table:
+------------+--------+-------------+
| short_code | status | assigned_to |
+------------+--------+-------------+
| aB3kX9p    | used   | server-3    |
| aB3kX9q    | free   | NULL        |
| aB3kX9r    | free   | NULL        |
| ...        | ...    | ...         |
+------------+--------+-------------+

Flow:
1. KGS pre-generates codes in background (e.g., 10M at a time)
2. API server requests batch: "Give me 1000 free codes"
3. KGS atomically marks 1000 codes as "used" and returns them
4. API server assigns codes from its local batch (zero contention)
5. When batch runs low (< 200 remaining), server requests a new batch
```

**Approach 4: Snowflake / TSID (Time-Sorted ID)**

Twitter's Snowflake and similar time-sorted ID generators produce 64-bit IDs that embed a timestamp, machine ID, and sequence number. These are globally unique without coordination (beyond initial machine ID assignment), roughly time-ordered, and fast to generate. The downside for a URL shortener is that a 64-bit integer encoded in Base62 is 11 characters — longer than the typical 6-7 character short code. You can truncate, but that reintroduces collision risk.

**Recommended Approach for Interviews:**

Lead with the KGS approach. It is clean, scalable, and demonstrates that you understand how to decouple concerns. Mention the counter-based and hash-based alternatives as trade-offs you considered. If the interviewer pushes on the KGS being a single point of failure, discuss replication and the API server buffer strategy. This progression — present a solution, acknowledge its weakness, explain mitigation — is the hallmark of a strong interview answer.

---

### Section 5 — Database Design

The database is the system's source of truth. Every short code and its destination URL must be stored durably. The schema is simple, but the choices around database technology and sharding strategy have far-reaching implications.

**Schema Design:**

```
Table: urls
+-------------+--------------+------------------------------------------+
| Column      | Type         | Description                              |
+-------------+--------------+------------------------------------------+
| short_code  | VARCHAR(7)   | Primary key, the short URL identifier    |
| long_url    | VARCHAR(2048)| The original destination URL              |
| user_id     | VARCHAR(36)  | UUID of the user who created the link    |
| created_at  | TIMESTAMP    | When the short URL was created           |
| expires_at  | TIMESTAMP    | When the short URL expires (nullable)    |
| click_count | BIGINT       | Denormalized click counter (optional)    |
+-------------+--------------+------------------------------------------+
Primary Key: short_code
Index: user_id (for "my links" dashboard)
Index: expires_at (for cleanup jobs)
```

The schema is intentionally lean. The `short_code` is the primary key because every read operation (redirect) looks up by short code. The `long_url` is the payload. The `user_id` allows users to manage their links. The `expires_at` enables time-limited URLs and cleanup. The `click_count` is a denormalized counter that avoids querying the analytics store for a simple display of total clicks — though updating it on every click requires careful handling (batched increments, not per-click writes).

**SQL vs NoSQL:**

This is a question interviewers expect you to address explicitly. Let us evaluate both options.

SQL (PostgreSQL, MySQL) offers strong consistency, ACID transactions, and mature tooling. It works well at moderate scale and when you need complex queries (e.g., "find all URLs created by user X that expire in the next 7 days"). However, at the scale we estimated (182.5 billion records over 5 years), a single SQL instance is insufficient. You would need sharding, which SQL databases do not natively support well. Application-level sharding with a SQL database is possible but adds significant operational complexity.

NoSQL (DynamoDB, Cassandra, MongoDB) excels at this workload. The access pattern is overwhelmingly key-value: given a short code, return the long URL. There are no complex joins, no multi-table transactions, and no need for a flexible query language. DynamoDB, for example, offers single-digit millisecond reads at any scale with built-in sharding and replication. Cassandra provides tunable consistency and handles massive write volumes with its log-structured merge-tree architecture. The trade-off is weaker consistency guarantees and less flexible querying, but for a URL shortener, these are acceptable.

The recommended choice for interviews is NoSQL, specifically DynamoDB or Cassandra, with a clear explanation of why the access pattern (point lookups by key) aligns perfectly with NoSQL's strengths. Mention that SQL would work at smaller scale and might be preferred if the product requires complex analytics queries directly against the URL store.

**Sharding Strategy:**

Regardless of database choice, at this scale you need to distribute data across multiple nodes. The natural sharding key is `short_code`. Hash-based sharding on `short_code` distributes data uniformly (since short codes are random) and ensures that every redirect lookup hits exactly one shard. This is ideal.

Avoid sharding by `user_id` — it creates hot spots (a single power user with millions of links overloads one shard) and does not align with the primary access pattern (redirects look up by short code, not user ID). If you need to query by `user_id` (e.g., for a dashboard), maintain a secondary index or a separate table that maps `user_id` to their `short_codes`.

**Replication:**

Configure at least 3 replicas per shard for durability and read scalability. Use eventual consistency for reads (redirects can tolerate a few seconds of staleness after a URL is created) and strong consistency for writes (to prevent duplicate short codes). In DynamoDB terms, use eventually consistent reads for redirects and strongly consistent reads only when checking for short code existence during creation.

---

### Section 6 — Caching and Performance

A URL shortener is a read-heavy system. Our estimates show a 10:1 read-to-write ratio, and real-world systems like bit.ly see ratios closer to 100:1 for popular links. Caching is not an optimization — it is a necessity.

**Cache-Aside Pattern:**

The standard approach is cache-aside (also called lazy loading) with Redis or Memcached. The flow for a redirect is: (1) Check Redis for the short code. (2) On a cache hit, return the long URL immediately. (3) On a cache miss, query the database, store the result in Redis with a TTL, then return the long URL. This pattern ensures the cache is populated on demand and only stores data that is actually being accessed.

```
Read Path with Cache-Aside:

  Client                API Server              Redis              Database
    |                       |                     |                    |
    |--- GET /aB3kX9p ----->|                     |                    |
    |                       |--- GET aB3kX9p ---->|                    |
    |                       |<-- Cache HIT -------|                    |
    |<-- 302 Redirect ------|                     |                    |

  (Cache miss scenario:)
    |--- GET /xY7mQ2w ----->|                     |                    |
    |                       |--- GET xY7mQ2w ---->|                    |
    |                       |<-- Cache MISS ------|                    |
    |                       |--- SELECT * WHERE short_code=... ------->|
    |                       |<-- { longUrl: "..." } ------------------|
    |                       |--- SET xY7mQ2w ---->|                    |
    |                       |    (TTL: 24 hours)  |                    |
    |<-- 302 Redirect ------|                     |                    |
```

For writes, after storing the new URL in the database, optionally write-through to the cache. This pre-warms the cache for newly created URLs, which are often accessed shortly after creation (the user tests their new link). However, this is not strictly necessary — the first redirect will populate the cache via the miss path.

**The 80/20 Rule Applied:**

The Pareto principle is remarkably accurate for URL shorteners. A small percentage of URLs receive the vast majority of traffic. A viral tweet with a shortened link might receive millions of clicks, while most shortened URLs are clicked fewer than 10 times. This means caching even a small fraction of URLs yields enormous hit rates.

From our earlier calculation, caching 10 million hot URLs requires about 5 GB of memory — trivial for a Redis cluster. In practice, a well-tuned cache achieves 90-95% hit rates for this workload, meaning only 5-10% of redirect requests reach the database. This dramatically reduces database load and keeps redirect latency under 10ms for cached URLs.

**Cache Eviction:**

Use LRU (Least Recently Used) eviction. URLs that have not been accessed recently are evicted to make room for active ones. Set a TTL (time-to-live) of 24-48 hours so that stale entries are eventually cleaned up even if the cache is not full. For URLs with explicit expiration dates, set the cache TTL to whichever is shorter: the default TTL or the time until expiration.

**CDN for Redirects:**

For a global user base, place a CDN (like CloudFlare or AWS CloudFront) in front of the API servers. The CDN can cache redirect responses at edge locations worldwide, reducing latency for users far from the origin servers. This works especially well with 301 (permanent) redirects, which CDNs and browsers cache aggressively.

**301 vs 302 Redirects — A Critical Trade-Off:**

This detail separates informed candidates from those who have only skimmed the topic. The HTTP redirect status code you choose has significant implications.

A **301 (Moved Permanently)** tells the browser (and CDN, and search engines) that the redirect is permanent. The browser caches the redirect and will not contact your server for subsequent clicks on the same link. This reduces server load and improves user-perceived latency — but you lose visibility into clicks. You cannot count how many times a link is clicked because the browser bypasses your server after the first visit.

A **302 (Found / Temporary Redirect)** tells the browser that the redirect is temporary. The browser will contact your server on every click, giving you accurate click analytics. The trade-off is higher server load and slightly higher latency for repeat clicks.

For a system that values analytics (which is most URL shorteners), use 302 redirects. If analytics are not required and minimizing server load is the priority, use 301. In an interview, present both options and let the interviewer know you understand the trade-off. Most candidates default to 302 because analytics are a core feature.

---

### Section 7 — Scaling and Reliability

A URL shortener must be highly available. If the service goes down, every shortened URL on the internet becomes a dead link. This section covers how to build a system that scales horizontally and tolerates failures gracefully.

**Horizontal Scaling of API Servers:**

API servers are stateless — they hold no critical data in memory (the KGS code buffer is replenishable, and the worst case of losing it is just fetching a new batch). This means you can scale horizontally by adding more servers behind the load balancer. Auto-scaling groups (in AWS terms) can add or remove instances based on CPU utilization or request rate. During traffic spikes (e.g., a viral link), the system automatically provisions more servers.

The load balancer distributes traffic using round-robin or least-connections. For the redirect path, any server can handle any request since the short code to long URL mapping is in the shared cache and database. No session affinity is needed.

**Database Scaling:**

As described in Section 5, the database is sharded by `short_code`. Each shard handles a fraction of the keyspace. To add capacity, you add more shards and re-distribute a portion of the keyspace — a process that must be carefully orchestrated to avoid downtime. Using consistent hashing for shard assignment makes this process smoother: adding a new shard only requires moving data from adjacent shards rather than reshuffling everything.

Read replicas within each shard handle the high read volume. With a 10:1 read-to-write ratio (and the cache absorbing 90% of reads), the actual database read load is modest. Even so, having 2-3 read replicas per shard provides both capacity headroom and fault tolerance.

**Rate Limiting:**

Without rate limiting, a malicious user could generate millions of short URLs per second, exhausting the keyspace and database capacity. Implement rate limiting at the API gateway level: limit each authenticated user to, say, 100 URL creations per minute, and limit anonymous users to 10 per minute. For redirects, rate limiting is less critical (you want users to access links freely) but might be necessary to prevent scraping or DDoS attacks. Use token bucket or sliding window rate limiters as discussed in Topic 20.

**Consistent Hashing for Cache Distribution:**

When running a Redis cluster for caching, consistent hashing determines which Redis node stores each short code. This ensures that when a node is added or removed (due to scaling or failure), only a fraction of keys are remapped, rather than all of them. Without consistent hashing, a node failure could cause a "thundering herd" effect where all cached data is effectively lost, and millions of requests simultaneously hit the database. With consistent hashing, only the keys assigned to the failed node experience cache misses, which the database can handle.

**Fault Tolerance:**

Multiple layers of redundancy protect against failures. The load balancer runs in an active-passive or active-active configuration across availability zones. API servers are distributed across at least two availability zones. The database uses multi-region replication for disaster recovery. Redis runs as a cluster with automatic failover (Redis Sentinel or AWS ElastiCache with Multi-AZ). The KGS is replicated, and API servers maintain a local buffer of pre-generated keys to survive brief KGS outages.

If the entire cache layer fails, the system degrades gracefully: redirects still work but with higher latency as all requests hit the database. If a database shard fails, its replicas promote to primary. If an entire region fails, DNS-based failover routes traffic to a secondary region. The goal is never to serve a "404 Not Found" for a valid short code — stale data is better than no data for a redirect service.

---

### Section 8 — Analytics and Tracking

Analytics transform a URL shortener from a simple redirect service into a valuable marketing and data platform. bit.ly built a significant business on this insight. However, analytics must never compromise the core redirect experience.

**Click Tracking Architecture:**

The cardinal rule is: never let analytics slow down redirects. When a user clicks a short link, the API server must return the redirect response as fast as possible. Analytics data is collected asynchronously. The pattern is:

1. The API server handles the redirect and extracts metadata from the request: IP address, User-Agent header, Referer header, timestamp.
2. The server publishes a click event to a message queue (Kafka, AWS SQS, or similar) with this metadata.
3. A separate analytics pipeline consumes events from the queue and writes them to an analytics data store.
4. Dashboard queries run against the analytics store, never against the primary URL database.

```
Click Event Schema (published to Kafka):
{
  "shortCode": "aB3kX9p",
  "timestamp": "2026-02-25T14:30:00Z",
  "ipAddress": "203.0.113.42",
  "userAgent": "Mozilla/5.0 (iPhone; ...) Safari/605.1",
  "referer": "https://twitter.com/...",
  "country": "US",        // derived from IP via GeoIP lookup
  "city": "San Francisco", // derived from IP
  "deviceType": "mobile",  // derived from User-Agent
  "browser": "Safari",     // derived from User-Agent
  "os": "iOS 19"           // derived from User-Agent
}
```

**Real-Time vs Batch Analytics:**

There are two modes. Real-time analytics use stream processing (Kafka Streams, Apache Flink) to aggregate click data as it arrives. This powers live dashboards showing clicks per minute, trending links, and geographic heat maps. Batch analytics run periodic jobs (hourly or daily via Apache Spark or similar) that compute aggregations like total clicks per link, click-through rates over time, and unique visitor counts. Most production systems use both: real-time for live dashboards and alerting, batch for accurate historical reports and reconciliation.

The analytics store should be optimized for time-series and aggregation queries. ClickHouse, Apache Druid, or AWS Timestream are excellent choices. These column-oriented databases handle the "count clicks grouped by country and hour for the last 30 days" query pattern efficiently.

**GeoIP and Device Parsing:**

The IP address is resolved to a geographic location using a GeoIP database (MaxMind GeoIP2 is the industry standard). The User-Agent string is parsed to extract device type, browser, and operating system. These enrichments can happen either in the API server (before publishing the event) or in the analytics pipeline (as a processing step). Doing it in the pipeline is preferred because it decouples the enrichment logic from the redirect path and allows re-processing if the GeoIP database is updated.

**Privacy Considerations:**

URL shorteners process significant amounts of user data. GDPR and CCPA compliance require careful handling of IP addresses (which are personal data in the EU). Best practices include: hashing or anonymizing IP addresses after GeoIP resolution, providing a "do not track" option, establishing data retention policies (e.g., delete click-level data after 90 days, keep only aggregates), and never selling or sharing individual click data with third parties. In an interview, mentioning privacy considerations briefly signals awareness of real-world engineering constraints beyond pure system design.

---

### Section 9 — Trade-Offs and Design Decisions

Every system design is a collection of trade-offs. Interviewers are not looking for a perfect design — they are looking for your ability to reason about alternatives and justify your choices. Here are the key trade-offs in a URL shortener, presented as decisions a real engineering team would debate.

**Consistency vs Availability:**

According to the CAP theorem, during a network partition, we must choose between consistency and availability. For a URL shortener, availability is paramount. A redirect that serves a slightly stale mapping (e.g., a URL was just updated but the old redirect still works) is vastly preferable to a redirect that fails entirely. This pushes us toward AP systems like Cassandra or DynamoDB with eventual consistency for reads. The one place where we need strong consistency is key generation — we must never assign the same short code to two different URLs. The KGS approach sidesteps this by pre-allocating codes atomically.

**SQL vs NoSQL:**

As discussed in Section 5, NoSQL wins for the primary URL store because the access pattern is dominated by point lookups on the short code. SQL might be used for auxiliary functions like user account management, billing, or the KGS metadata table. A polyglot persistence approach — NoSQL for the URL store, SQL for operational data — is entirely reasonable and reflects real-world practice.

**301 vs 302 Redirects:**

Covered in Section 6. Choose 302 if analytics matter (they almost always do). Choose 301 if minimizing server load is the top priority. A nuanced answer in an interview mentions the option to use 307 (Temporary Redirect) which, unlike 302, guarantees the HTTP method is preserved during the redirect — though for URL shorteners (which only use GET), this distinction is moot.

**Hash-Based vs Counter-Based vs KGS Key Generation:**

Each approach has a place. Hash-based is simplest to implement but requires collision handling. Counter-based guarantees uniqueness but requires distributed coordination. KGS pre-generates keys, eliminating both collisions and runtime coordination, at the cost of additional infrastructure. For an interview, recommend KGS and discuss the alternatives as trade-offs you evaluated. This shows breadth of knowledge and decision-making skill.

**Custom Alias Handling:**

Custom aliases introduce a namespace problem. A user who requests `short.ly/sale` might conflict with another user who wants the same alias. The solution is first-come-first-served with a uniqueness check in the database. Custom aliases should be validated against a blocklist (no profanity, no impersonation of system paths like `/api` or `/health`), length-restricted (3-30 characters), and character-restricted (alphanumeric plus hyphens). Custom aliases also bypass the KGS entirely — they are user-specified, not system-generated.

**URL Expiration and Cleanup:**

Expired URLs should not continue to redirect. Two strategies exist. Lazy expiration: check the `expires_at` field on every redirect and return 404 if expired. This is simple but leaves expired records in the database forever. Active expiration: run a periodic cleanup job that deletes expired records and returns their short codes to the KGS for reuse. The recommended approach is both: lazy expiration for immediate correctness, plus a background cleanup job for storage reclamation. The cleanup job can run during off-peak hours to minimize database load.

A subtle point: should expired short codes be recycled? In theory, yes — it keeps the keyspace fresh. In practice, recycling is dangerous. If short code "aB3kX9p" once pointed to a product page and is later reassigned to a different URL, anyone with the old link reaches the wrong destination. Most production systems choose not to recycle codes, accepting the (very minor) keyspace cost for the (very significant) safety guarantee.

---

### Section 10 — Interview Questions

The following questions span three difficulty tiers. For each question, a model answer is provided that demonstrates the depth and structure interviewers expect. Practice verbalizing these answers — a system design interview is an oral exam, not a written one.

**Beginner Tier:**

**Q1: How would you generate a unique short code for each URL?**

Model Answer: "There are three main approaches. First, I could hash the long URL using MD5 or SHA-256 and take the first 7 characters of the Base62-encoded hash. This is simple and stateless but has collision risk — with billions of URLs, I'd need to check for collisions and retry with a modified input. Second, I could use a distributed counter like Twitter's Snowflake to generate unique IDs and Base62-encode them, but this produces longer codes (11 characters for a 64-bit ID). Third, and what I'd recommend, is a Key Generation Service that pre-generates unique codes in batches. API servers fetch batches of codes from the KGS, eliminating runtime collisions and coordination overhead. The KGS can be replicated for availability, and API servers keep a local buffer to survive brief outages."

**Q2: Why might you choose NoSQL over SQL for the URL storage?**

Model Answer: "The primary access pattern for a URL shortener is a point lookup: given a short code, return the long URL. This is exactly the pattern that key-value NoSQL databases like DynamoDB or Cassandra are optimized for. We don't need joins, complex transactions, or a rich query language for this table. At our scale — billions of records — SQL databases require manual sharding, which is operationally complex. NoSQL databases handle sharding natively. Additionally, for redirects, eventual consistency is acceptable (a new URL might take a second to propagate to all replicas), and NoSQL databases offer tunable consistency that lets us optimize for read latency. I'd still use SQL for auxiliary data like user accounts and billing where complex queries and strong consistency are needed."

**Q3: What happens when a user clicks a short URL? Walk through the full request flow.**

Model Answer: "The user's browser sends an HTTP GET request to, say, `short.ly/aB3kX9p`. DNS resolves `short.ly` to the load balancer's IP. The load balancer routes the request to one of our stateless API servers. The server extracts the short code `aB3kX9p` and checks the Redis cache. If it's a cache hit, the server immediately returns an HTTP 302 response with the `Location` header set to the long URL. If it's a cache miss, the server queries the database using the short code as the key, stores the result in Redis with a 24-hour TTL, and then returns the 302 redirect. In both cases, the server asynchronously publishes a click event to Kafka for analytics processing. The user's browser receives the 302, follows the `Location` header, and loads the destination page. Total time for a cached redirect: under 10ms."

**Mid-Level Tier:**

**Q4: How would you handle the case where the system receives 100,000 requests per second for the same short URL (a viral link)?**

Model Answer: "This is the 'hot key' problem. First, our Redis cache will absorb most of the load since the URL will be cached after the first request. But even Redis can struggle with 100K requests per second for a single key if all requests hit the same Redis node. I'd address this in layers. First, use local in-memory caching on each API server (a small LRU cache with a short TTL, say 30 seconds) to serve hot URLs without even hitting Redis. Second, if using a Redis cluster, replicate the hot key across multiple Redis nodes using read replicas. Third, a CDN layer in front of our service can cache the 302 redirect at edge locations worldwide, distributing the load geographically. Fourth, if the URL is known to be viral (e.g., it's been flagged or hit a threshold), we could proactively push it to all API server local caches. The combination of local cache, Redis, and CDN ensures no single component is overwhelmed."

**Q5: How would you design the system to support URL expiration?**

Model Answer: "I'd implement a two-layer approach. The first layer is lazy expiration: on every redirect request, after retrieving the URL record, check the `expires_at` field. If the current time is past the expiration, return an HTTP 404 or a custom 'link expired' page instead of redirecting. This ensures no expired link ever successfully redirects, with zero additional infrastructure. The second layer is active cleanup: a scheduled background job runs periodically (e.g., every hour) and queries for records where `expires_at < NOW()`. It deletes these records from the database and invalidates them from the cache. An index on `expires_at` makes this query efficient. I would not recycle expired short codes because reuse could cause confusion if old links are still referenced somewhere. The cache TTL should be set to `min(default_TTL, time_until_expiry)` so that cached entries expire at the right time without a manual invalidation."

**Q6: How would you design the analytics pipeline to track clicks without impacting redirect latency?**

Model Answer: "The key principle is asynchronous processing. When a redirect request is served, the API server extracts metadata from the HTTP request — IP address, User-Agent, Referer, timestamp — and publishes a click event to a Kafka topic. This publish operation takes less than 1ms and does not block the redirect response. A separate analytics service consumes events from Kafka. It enriches the events (GeoIP lookup for country/city, User-Agent parsing for device/browser/OS) and writes them to a time-series database like ClickHouse. For real-time dashboards, a stream processing layer (Kafka Streams or Flink) maintains running aggregations like clicks per minute per short code. For historical reports, a daily batch job aggregates click data into summary tables. The analytics store is entirely separate from the URL store, so analytics queries never impact redirect performance. I'd also maintain a denormalized `click_count` column on the URL record itself, updated in batches (e.g., every 5 minutes) from the analytics pipeline, for the common 'total clicks' display."

**Senior Tier:**

**Q7: How would you design the Key Generation Service to be highly available and handle multiple data centers?**

Model Answer: "The KGS needs to be available across data centers without generating duplicate codes. I'd assign each data center a unique prefix or range. For example, with three data centers, DC1 generates codes in the range 0 to 1.17 trillion, DC2 from 1.17T to 2.34T, and DC3 from 2.34T to 3.52T. Within each data center, the KGS runs as a replicated service with a primary that allocates batches and secondaries that can promote if the primary fails. The batch allocation is an atomic operation: 'UPDATE kgs_codes SET status = allocated, assigned_to = server_id WHERE status = free LIMIT 1000'. If I want to avoid range-based partitioning (which makes codes predictable per DC), I can use a random generation approach: each KGS instance generates random 7-character Base62 codes, checks for uniqueness against a shared Bloom filter and the database, and stores confirmed unique codes. The Bloom filter provides fast probably-unique checks, and the database provides ground truth. API servers request batches from their local KGS, maintaining a buffer of 1000-5000 codes. If the local KGS is down, the server can fall back to requesting from another data center's KGS, accepting the cross-DC latency for the batch request (not for individual redirects)."

**Q8: If you had to migrate this system from a monolithic architecture to microservices, how would you decompose it?**

Model Answer: "I'd identify four natural service boundaries. First, the URL Service handles creation and storage of URL mappings — it owns the URL database and exposes endpoints for creating and retrieving URLs. Second, the Redirect Service is a thin, latency-optimized service that handles GET requests for short codes — it reads from the cache and URL database but never writes. Separating it lets us optimize it independently for latency (minimal dependencies, aggressive caching, deployed close to users). Third, the Key Generation Service is already a separate concern in our design. Fourth, the Analytics Service owns the click event pipeline and analytics store. The services communicate via APIs for synchronous operations (Redirect Service calls URL Service on a cache miss) and via Kafka for asynchronous operations (click events). The decomposition allows independent scaling — we can run 10x more Redirect Service instances than URL Service instances to match the read-heavy traffic pattern. The risk is increased operational complexity and potential for cascading failures, which we mitigate with circuit breakers, retries with exponential backoff, and bulkhead isolation."

**Q9: How would you prevent abuse of the URL shortener (spam, phishing, malware distribution)?**

Model Answer: "Abuse prevention is a critical production concern. I'd implement multiple layers. First, rate limiting prevents automated bulk creation — limit by API key, IP address, and user account. Second, at creation time, check the long URL against known phishing and malware databases like Google Safe Browsing API and PhishTank. Reject or flag URLs that match. Third, use heuristic analysis: newly created URLs that immediately receive high traffic from diverse IPs might be spam campaigns. Fourth, implement a reporting mechanism where users can flag malicious short URLs, and have a review queue for flagged links. Fifth, maintain a domain blocklist of known malicious domains and a pattern detector for suspicious URL structures. Sixth, for flagged or suspicious URLs, serve an interstitial warning page ('You are about to visit...') instead of a direct redirect. Seventh, log all creation events with user identity and IP for forensic analysis. The abuse prevention system should be its own microservice that the URL creation path consults asynchronously — check the URL against the blocklist synchronously (fast lookup), but deeper analysis (Safe Browsing API, heuristics) can happen asynchronously with the URL flagged for review if concerns arise."

---

### Section 11 — Complete Code Example

Below is a complete implementation of a URL shortener service. We start with pseudocode that captures the design, then provide a working Node.js implementation with line-by-line explanations.

**Pseudocode Design:**

```
SERVICE URLShortener:

  CONSTANTS:
    BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    CODE_LENGTH = 7
    CACHE_TTL = 86400  // 24 hours in seconds
    KGS_BATCH_SIZE = 1000
    KGS_REFILL_THRESHOLD = 200

  STATE:
    codeBuffer = []       // Local buffer of pre-generated codes from KGS
    database = NoSQLClient // Connection to DynamoDB/Cassandra
    cache = RedisClient    // Connection to Redis cluster
    queue = KafkaProducer  // Connection to analytics queue

  FUNCTION shortenURL(longUrl, customAlias?, expiresAt?):
    // Validate input
    IF NOT isValidURL(longUrl):
      RETURN Error("Invalid URL format")

    // Handle custom alias
    IF customAlias IS PROVIDED:
      IF NOT isValidAlias(customAlias):
        RETURN Error("Invalid alias: must be 3-30 alphanumeric characters")
      IF database.exists(customAlias):
        RETURN Error("Alias already taken")
      shortCode = customAlias
    ELSE:
      // Get code from local buffer (KGS approach)
      shortCode = getNextCode()

    // Store in database
    record = {
      shortCode: shortCode,
      longUrl: longUrl,
      userId: currentUser.id,
      createdAt: NOW(),
      expiresAt: expiresAt OR NULL,
      clickCount: 0
    }
    database.put("urls", record)

    // Pre-warm cache
    cache.set(shortCode, longUrl, TTL = CACHE_TTL)

    RETURN { shortUrl: "https://short.ly/" + shortCode, shortCode, expiresAt }

  FUNCTION redirect(shortCode):
    // Step 1: Check cache
    longUrl = cache.get(shortCode)

    // Step 2: On cache miss, check database
    IF longUrl IS NULL:
      record = database.get("urls", shortCode)
      IF record IS NULL:
        RETURN HttpResponse(404, "Short URL not found")

      // Check expiration (lazy expiration)
      IF record.expiresAt IS NOT NULL AND record.expiresAt < NOW():
        RETURN HttpResponse(410, "This link has expired")

      longUrl = record.longUrl
      // Populate cache
      ttl = calculateTTL(record.expiresAt)
      cache.set(shortCode, longUrl, TTL = ttl)

    // Step 3: Publish analytics event (async, non-blocking)
    queue.publishAsync("click-events", {
      shortCode: shortCode,
      timestamp: NOW(),
      ipAddress: request.ip,
      userAgent: request.headers["User-Agent"],
      referer: request.headers["Referer"]
    })

    // Step 4: Return redirect
    RETURN HttpResponse(302, headers = { "Location": longUrl })

  FUNCTION getNextCode():
    // Refill buffer if running low
    IF codeBuffer.length < KGS_REFILL_THRESHOLD:
      newCodes = kgsService.fetchBatch(KGS_BATCH_SIZE)
      codeBuffer.append(newCodes)

    RETURN codeBuffer.pop()

  FUNCTION calculateTTL(expiresAt):
    IF expiresAt IS NULL:
      RETURN CACHE_TTL
    remainingSeconds = expiresAt - NOW() (in seconds)
    RETURN MIN(CACHE_TTL, remainingSeconds)

  FUNCTION base62Encode(number):
    IF number == 0:
      RETURN "0"
    result = ""
    WHILE number > 0:
      remainder = number % 62
      result = BASE62_CHARS[remainder] + result
      number = FLOOR(number / 62)
    RETURN result
```

**Node.js Implementation:**

```javascript
// url-shortener-service.js
// A complete URL shortener implementation demonstrating core concepts.
// In production, this would be split across multiple files and services.

const express = require('express');        // Web framework for handling HTTP requests
const Redis = require('ioredis');          // Redis client for caching
const { DynamoDB } = require('@aws-sdk/client-dynamodb');  // AWS DynamoDB client
const { Kafka } = require('kafkajs');      // Kafka client for async analytics
const { v4: uuidv4 } = require('uuid');   // UUID generation for request tracing

// --- Configuration ---
// All magic numbers are extracted to config for easy tuning.
const CONFIG = {
  PORT: 3000,                    // Server listening port
  BASE_URL: 'https://short.ly',  // The domain for generated short URLs
  CODE_LENGTH: 7,                // Length of generated short codes
  CACHE_TTL: 86400,              // Cache time-to-live: 24 hours in seconds
  KGS_BATCH_SIZE: 1000,          // Number of codes to fetch from KGS per batch
  KGS_REFILL_THRESHOLD: 200,     // Fetch new batch when buffer drops below this
  MAX_URL_LENGTH: 2048,          // Maximum allowed length for a long URL
  CUSTOM_ALIAS_MIN: 3,           // Minimum custom alias length
  CUSTOM_ALIAS_MAX: 30,          // Maximum custom alias length
  RATE_LIMIT_WINDOW: 60000,      // Rate limit window: 1 minute in milliseconds
  RATE_LIMIT_MAX_REQUESTS: 100,  // Max URL creations per window per user
};

// --- Base62 Encoder ---
// Base62 uses 0-9, a-z, A-Z (62 characters total).
// A 7-character Base62 string can represent 62^7 = 3.52 trillion unique values.
const BASE62_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Encodes a non-negative integer into a Base62 string.
 * Used to convert numeric IDs into short, URL-safe strings.
 *
 * @param {number} num - The number to encode (must be >= 0)
 * @returns {string} The Base62-encoded string
 *
 * Example: base62Encode(1000000) returns "4c92"
 */
function base62Encode(num) {
  if (num === 0) return '0';                // Edge case: zero encodes to '0'

  let encoded = '';                          // Build the result string
  while (num > 0) {                          // Process each digit position
    const remainder = num % 62;              // Get the current Base62 digit
    encoded = BASE62_CHARS[remainder] + encoded;  // Prepend the character
    num = Math.floor(num / 62);              // Move to the next digit position
  }

  return encoded;
}

/**
 * Decodes a Base62 string back into a number.
 * Used for debugging and validation; not needed in the hot path.
 *
 * @param {string} str - The Base62-encoded string
 * @returns {number} The decoded number
 */
function base62Decode(str) {
  let num = 0;                               // Accumulate the decoded value
  for (const char of str) {                  // Process each character
    num = num * 62 + BASE62_CHARS.indexOf(char);  // Shift and add digit value
  }
  return num;
}

// --- URL Validator ---
// Validates that a string is a well-formed URL with http or https protocol.
// This prevents storing malformed URLs that would cause redirect failures.
function isValidUrl(url) {
  try {
    const parsed = new URL(url);              // Built-in URL parser; throws on invalid input
    return ['http:', 'https:'].includes(parsed.protocol);  // Only allow HTTP(S)
  } catch {
    return false;                             // Parsing failed, not a valid URL
  }
}

// Validates custom alias format: alphanumeric and hyphens only,
// within length bounds. Prevents injection and namespace collisions.
function isValidAlias(alias) {
  const pattern = /^[a-zA-Z0-9-]+$/;         // Alphanumeric plus hyphens
  return (
    alias.length >= CONFIG.CUSTOM_ALIAS_MIN &&   // At least 3 characters
    alias.length <= CONFIG.CUSTOM_ALIAS_MAX &&   // At most 30 characters
    pattern.test(alias) &&                        // Matches allowed characters
    !RESERVED_PATHS.includes(alias)               // Not a system-reserved path
  );
}

// Paths that cannot be used as custom aliases because they conflict
// with system routes (API endpoints, health checks, etc.).
const RESERVED_PATHS = ['api', 'health', 'metrics', 'admin', 'login', 'signup'];

// --- Service Class ---
// Encapsulates all URL shortener logic. In production, this would be
// further decomposed into separate services (URL service, redirect service, etc.).
class URLShortenerService {
  constructor() {
    // Redis client for caching URL mappings.
    // Using a cluster configuration for production readiness.
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: 6379,
      retryDelayOnFailover: 100,              // Retry quickly on failover
      maxRetriesPerRequest: 3,                // Don't hang forever on Redis issues
    });

    // DynamoDB client for persistent URL storage.
    // DynamoDB handles sharding and replication automatically.
    this.dynamodb = new DynamoDB({
      region: process.env.AWS_REGION || 'us-east-1',
    });

    // Kafka producer for publishing click events to the analytics pipeline.
    // Events are published asynchronously to avoid impacting redirect latency.
    this.kafka = new Kafka({
      clientId: 'url-shortener',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    });
    this.kafkaProducer = this.kafka.producer();

    // Local buffer of pre-generated short codes from the KGS.
    // Codes are consumed from this buffer on each URL creation,
    // eliminating the need for runtime key generation or collision checking.
    this.codeBuffer = [];

    // Simple in-memory rate limiter.
    // Maps userId -> { count, windowStart }.
    // In production, use Redis-based rate limiting for distributed coordination.
    this.rateLimits = new Map();
  }

  /**
   * Initialize connections and pre-fetch the first batch of codes.
   * Called once at server startup.
   */
  async initialize() {
    await this.kafkaProducer.connect();       // Connect to Kafka cluster
    await this.refillCodeBuffer();            // Pre-fetch codes from KGS
    console.log('URLShortenerService initialized');
  }

  /**
   * Fetches a batch of pre-generated codes from the Key Generation Service.
   * In a real system, this calls a separate KGS microservice.
   * Here, we simulate it with Base62 encoding of random numbers.
   */
  async refillCodeBuffer() {
    // In production: const codes = await kgsClient.fetchBatch(CONFIG.KGS_BATCH_SIZE);
    // Simulation: generate random codes (KGS would guarantee uniqueness)
    const newCodes = [];
    for (let i = 0; i < CONFIG.KGS_BATCH_SIZE; i++) {
      // Generate a random number and encode it in Base62.
      // Pad to CODE_LENGTH characters for uniform short URLs.
      const randomNum = Math.floor(Math.random() * Math.pow(62, CONFIG.CODE_LENGTH));
      const code = base62Encode(randomNum).padStart(CONFIG.CODE_LENGTH, '0');
      newCodes.push(code);
    }
    this.codeBuffer.push(...newCodes);        // Add new codes to the buffer
    console.log(`Refilled code buffer. Size: ${this.codeBuffer.length}`);
  }

  /**
   * Gets the next available short code from the local buffer.
   * Triggers a background refill when the buffer is running low.
   *
   * @returns {string} A unique 7-character short code
   * @throws {Error} If the buffer is empty and refill fails
   */
  async getNextCode() {
    // Trigger background refill when buffer drops below threshold.
    // We don't await this — it happens in the background while we
    // still have codes to serve from the remaining buffer.
    if (this.codeBuffer.length < CONFIG.KGS_REFILL_THRESHOLD) {
      this.refillCodeBuffer().catch(err =>
        console.error('Failed to refill code buffer:', err)
      );
    }

    // Pop a code from the buffer. If empty, do a synchronous refill.
    if (this.codeBuffer.length === 0) {
      await this.refillCodeBuffer();          // Blocking refill as last resort
    }

    return this.codeBuffer.pop();             // Return the next available code
  }

  /**
   * Checks if a user has exceeded their rate limit for URL creation.
   * Uses a simple sliding window approach.
   *
   * @param {string} userId - The user's identifier
   * @returns {boolean} True if the request should be rejected
   */
  isRateLimited(userId) {
    const now = Date.now();
    const limit = this.rateLimits.get(userId);

    if (!limit || now - limit.windowStart > CONFIG.RATE_LIMIT_WINDOW) {
      // First request or window expired: start a new window
      this.rateLimits.set(userId, { count: 1, windowStart: now });
      return false;
    }

    if (limit.count >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
      return true;                            // Rate limit exceeded
    }

    limit.count++;                            // Increment within current window
    return false;
  }

  /**
   * Creates a shortened URL.
   * This is the write path — validates input, generates or validates the
   * short code, stores the mapping, and pre-warms the cache.
   *
   * @param {string} longUrl - The destination URL to shorten
   * @param {string} userId - The ID of the user creating the link
   * @param {string} [customAlias] - Optional custom short code
   * @param {string} [expiresAt] - Optional ISO 8601 expiration timestamp
   * @returns {Object} The created short URL details
   */
  async createShortUrl(longUrl, userId, customAlias = null, expiresAt = null) {
    // --- Input Validation ---
    if (!longUrl || !isValidUrl(longUrl)) {
      throw new Error('Invalid URL format. Must be a valid HTTP or HTTPS URL.');
    }

    if (longUrl.length > CONFIG.MAX_URL_LENGTH) {
      throw new Error(`URL exceeds maximum length of ${CONFIG.MAX_URL_LENGTH} characters.`);
    }

    // --- Rate Limiting ---
    if (this.isRateLimited(userId)) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    // --- Short Code Assignment ---
    let shortCode;

    if (customAlias) {
      // Custom alias: validate format and check availability
      if (!isValidAlias(customAlias)) {
        throw new Error('Invalid alias. Use 3-30 alphanumeric characters or hyphens.');
      }

      // Check if alias is already taken (strong consistency read)
      const existing = await this.getFromDatabase(customAlias);
      if (existing) {
        throw new Error('This custom alias is already taken. Please choose another.');
      }

      shortCode = customAlias;
    } else {
      // System-generated code from KGS buffer
      shortCode = await this.getNextCode();
    }

    // --- Persistence ---
    const record = {
      shortCode,                              // Primary key
      longUrl,                                // The destination
      userId,                                 // Creator for ownership tracking
      createdAt: new Date().toISOString(),    // Creation timestamp
      expiresAt: expiresAt || null,           // Optional expiration
      clickCount: 0,                          // Initial click count
    };

    // Write to DynamoDB (primary data store)
    await this.saveToDatabase(record);

    // Pre-warm the cache so the first redirect is fast
    const ttl = this.calculateCacheTTL(expiresAt);
    await this.redis.setex(
      `url:${shortCode}`,                    // Cache key with prefix
      ttl,                                    // Time-to-live in seconds
      longUrl                                 // The cached value
    );

    return {
      shortUrl: `${CONFIG.BASE_URL}/${shortCode}`,
      shortCode,
      longUrl,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Handles a redirect request for a short code.
   * This is the read path — the most latency-sensitive operation.
   * Checks cache first, falls back to database, publishes analytics async.
   *
   * @param {string} shortCode - The short code to resolve
   * @param {Object} requestMeta - Request metadata for analytics
   * @returns {Object} The redirect target URL or an error
   */
  async resolveShortUrl(shortCode, requestMeta = {}) {
    // --- Step 1: Check Redis Cache ---
    // This is the fast path. ~90% of requests are served from cache.
    const cachedUrl = await this.redis.get(`url:${shortCode}`);

    if (cachedUrl) {
      // Cache hit: publish analytics asynchronously and return immediately.
      // The setImmediate ensures the analytics publish doesn't block the response.
      setImmediate(() => this.publishClickEvent(shortCode, requestMeta));

      return { longUrl: cachedUrl, statusCode: 302 };
    }

    // --- Step 2: Cache Miss — Query Database ---
    const record = await this.getFromDatabase(shortCode);

    if (!record) {
      return { error: 'Short URL not found', statusCode: 404 };
    }

    // --- Step 3: Check Expiration (Lazy Expiration) ---
    // Even though we have a cleanup job, we always check here for correctness.
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return { error: 'This link has expired', statusCode: 410 };
    }

    // --- Step 4: Populate Cache ---
    // Store in cache so subsequent requests for this code are fast.
    const ttl = this.calculateCacheTTL(record.expiresAt);
    await this.redis.setex(`url:${shortCode}`, ttl, record.longUrl);

    // --- Step 5: Publish Analytics Event (Async) ---
    setImmediate(() => this.publishClickEvent(shortCode, requestMeta));

    return { longUrl: record.longUrl, statusCode: 302 };
  }

  /**
   * Calculates the appropriate cache TTL for a URL record.
   * If the URL has an expiration, the TTL is the shorter of the
   * default TTL and the time remaining until expiration.
   *
   * @param {string|null} expiresAt - ISO 8601 expiration timestamp or null
   * @returns {number} TTL in seconds
   */
  calculateCacheTTL(expiresAt) {
    if (!expiresAt) {
      return CONFIG.CACHE_TTL;                // Default: 24 hours
    }

    const remainingSeconds = Math.floor(
      (new Date(expiresAt) - new Date()) / 1000
    );

    // Use the shorter of default TTL and time until expiration.
    // This prevents the cache from serving a redirect after the URL expires.
    return Math.max(1, Math.min(CONFIG.CACHE_TTL, remainingSeconds));
  }

  /**
   * Publishes a click event to Kafka for asynchronous analytics processing.
   * This method is fire-and-forget — failures are logged but do not
   * impact the redirect response.
   *
   * @param {string} shortCode - The short code that was clicked
   * @param {Object} meta - Request metadata (IP, User-Agent, Referer)
   */
  async publishClickEvent(shortCode, meta) {
    try {
      const event = {
        shortCode,
        timestamp: new Date().toISOString(),
        ipAddress: meta.ip || 'unknown',
        userAgent: meta.userAgent || 'unknown',
        referer: meta.referer || 'direct',
        requestId: uuidv4(),                  // For deduplication in the pipeline
      };

      await this.kafkaProducer.send({
        topic: 'click-events',                // Kafka topic for click analytics
        messages: [{
          key: shortCode,                     // Partition by short code for ordering
          value: JSON.stringify(event),        // Serialized event payload
        }],
      });
    } catch (error) {
      // Log but don't throw — analytics failures must never break redirects.
      console.error('Failed to publish click event:', error.message);
    }
  }

  /**
   * Saves a URL record to DynamoDB.
   * Uses PutItem with a condition to prevent overwriting existing records
   * (important for custom alias uniqueness).
   */
  async saveToDatabase(record) {
    const params = {
      TableName: 'urls',
      Item: {
        shortCode: { S: record.shortCode },
        longUrl:   { S: record.longUrl },
        userId:    { S: record.userId },
        createdAt: { S: record.createdAt },
        expiresAt: record.expiresAt ? { S: record.expiresAt } : { NULL: true },
        clickCount: { N: '0' },
      },
      // Condition ensures we never overwrite an existing mapping.
      // This is critical for custom alias uniqueness.
      ConditionExpression: 'attribute_not_exists(shortCode)',
    };

    await this.dynamodb.putItem(params);
  }

  /**
   * Retrieves a URL record from DynamoDB by short code.
   * Uses eventually consistent reads for redirects (faster, cheaper)
   * and strongly consistent reads for existence checks during creation.
   */
  async getFromDatabase(shortCode, consistentRead = false) {
    const params = {
      TableName: 'urls',
      Key: { shortCode: { S: shortCode } },
      ConsistentRead: consistentRead,         // Strong consistency for writes
    };

    const result = await this.dynamodb.getItem(params);

    if (!result.Item) return null;

    return {
      shortCode: result.Item.shortCode.S,
      longUrl: result.Item.longUrl.S,
      userId: result.Item.userId.S,
      createdAt: result.Item.createdAt.S,
      expiresAt: result.Item.expiresAt?.S || null,
      clickCount: parseInt(result.Item.clickCount?.N || '0'),
    };
  }
}

// --- Express HTTP Server ---
// Sets up the API routes and connects them to the service layer.

const app = express();
app.use(express.json());                      // Parse JSON request bodies

const service = new URLShortenerService();

// --- Write Path: Create Short URL ---
// POST /api/v1/shorten
// Accepts a long URL and optional parameters, returns a short URL.
app.post('/api/v1/shorten', async (req, res) => {
  try {
    const { longUrl, customAlias, expiresAt } = req.body;
    const userId = req.headers['x-user-id'] || 'anonymous';  // Auth would set this

    const result = await service.createShortUrl(longUrl, userId, customAlias, expiresAt);

    res.status(201).json(result);             // 201 Created
  } catch (error) {
    // Determine appropriate HTTP status from error type
    const status = error.message.includes('Rate limit') ? 429
                 : error.message.includes('already taken') ? 409
                 : 400;
    res.status(status).json({ error: error.message });
  }
});

// --- Read Path: Redirect ---
// GET /:shortCode
// Resolves the short code and redirects to the destination URL.
// This is the most latency-sensitive endpoint in the entire system.
app.get('/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;

    // Collect request metadata for analytics
    const requestMeta = {
      ip: req.ip || req.connection.remoteAddress,   // Client IP for GeoIP
      userAgent: req.headers['user-agent'],          // Browser/device detection
      referer: req.headers['referer'],               // Traffic source tracking
    };

    const result = await service.resolveShortUrl(shortCode, requestMeta);

    if (result.error) {
      return res.status(result.statusCode).json({ error: result.error });
    }

    // 302 Found: Temporary redirect.
    // We use 302 (not 301) so the browser contacts us on every click,
    // enabling accurate click analytics. A 301 would cause the browser
    // to cache the redirect and bypass our server on subsequent clicks.
    res.redirect(302, result.longUrl);
  } catch (error) {
    console.error('Redirect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Health Check ---
// Used by the load balancer to verify this server is healthy.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', bufferSize: service.codeBuffer.length });
});

// --- Server Startup ---
async function startServer() {
  await service.initialize();                 // Connect to all dependencies
  app.listen(CONFIG.PORT, () => {
    console.log(`URL Shortener running on port ${CONFIG.PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);                            // Exit on startup failure
});
```

**Line-by-Line Walkthrough of Key Sections:**

The `createShortUrl` method is the write path. It first validates the input URL and checks rate limits — these are cheap operations that short-circuit bad requests early. If a custom alias is provided, it validates the format against allowed characters and length, then performs a strongly consistent read to check availability (we cannot tolerate a race condition where two users claim the same alias). If no custom alias is provided, it draws from the KGS buffer, which is a simple `pop()` with no network call. The record is written to DynamoDB with a conditional expression that prevents overwrites, providing an additional safety net. Finally, the cache is pre-warmed so the first redirect is fast.

The `resolveShortUrl` method is the read path and the latency-critical hot loop. It checks Redis first — this is a single `GET` command that typically completes in under 1ms. On a hit, it immediately schedules analytics asynchronously (using `setImmediate` to defer to the next event loop tick) and returns the redirect. On a miss, it queries DynamoDB (single-digit milliseconds with eventually consistent reads), checks expiration, populates the cache, and then returns. The analytics are always asynchronous and fire-and-forget — a failed Kafka publish is logged but never blocks or fails the redirect.

The `publishClickEvent` method demonstrates the principle of isolation. It wraps the entire Kafka publish in a try-catch, ensuring that analytics infrastructure failures cannot cascade into redirect failures. The event is keyed by `shortCode` so that all clicks for the same URL land on the same Kafka partition, preserving ordering for per-URL analytics.

---

### Section 12 — Connection to Next Topic

The URL shortener you just designed is the simplest member of a family of systems that map short identifiers to stored content. In Topic 41, we will design a Paste Bin service (like Pastebin.com or GitHub Gists), which extends the core pattern in several meaningful ways.

The fundamental architecture is similar: a user submits content, receives a short URL, and anyone with that URL can retrieve the content. The API structure is nearly identical — a POST to create, a GET to retrieve. The key generation approach (KGS, Base62 encoding) transfers directly. Caching, load balancing, and database sharding all apply.

But a Paste Bin diverges from a URL shortener in important ways that deepen your understanding of system design. First, the payload is fundamentally different. A URL shortener stores a mapping from a short code to a string of at most 2,048 characters (a URL). A Paste Bin stores arbitrary text content that can be kilobytes or even megabytes. This changes the storage calculus entirely — you cannot store paste content in a simple database row. You need object storage (S3, GCS) for the content itself, with the database storing only metadata and a pointer to the object. Second, Paste Bin introduces content-addressable storage as a concept. If two users paste identical content, should the system store it once and point both short codes to the same blob? This is a deduplication optimization that does not arise in URL shorteners (where different users shortening the same URL still get different short codes for analytics isolation). Third, Paste Bin adds access control and syntax highlighting — the paste may be public, unlisted (accessible only via URL), or private (requires authentication). These features require an authorization layer that a URL shortener does not need for its core redirect function.

The progression from URL shortener to Paste Bin illustrates a core principle of system design interviews: once you master the fundamental pattern (short identifier to content mapping), you can adapt it to increasingly complex requirements by identifying what changes and what stays the same. The KGS, the cache layer, the sharding strategy, and the analytics pipeline all carry forward. What changes is the storage backend, the payload handling, and the access control model. This incremental reasoning — "it is like system X, but with these differences" — is exactly how experienced engineers approach new designs, and it is exactly what interviewers want to see.

---

*Next up: **Topic 41 — Design a Paste Bin**, where we extend the short-identifier pattern to handle large content payloads, object storage, content deduplication, and access control.*
---

<!--
topic: 41
title: Design a Paste Bin
section: "09 — Real-World Designs Part 1"
track: "0-to-100 Deep Mastery"
difficulty: beginner-mid
interview_weight: medium
estimated_time: 90 minutes
prerequisites:
  - Topic 1 (Client-Server Architecture)
  - Topic 2 (Networking Fundamentals)
  - Topic 3 (APIs and API Design)
  - Topic 6 (Databases and Storage)
  - Topic 10 (Caching)
  - Topic 12 (CDNs and Edge Networks)
  - Topic 40 (Design a URL Shortener)
next_topic: Topic 42 (Design a Rate Limiter)
-->

## Topic 41: Design a Paste Bin

---

### Section 1 --- Why This Design?

In 2002, a developer named Paul Dixon had a simple but persistent problem. He hung out in IRC channels -- the real-time chat rooms that were the lifeblood of the open-source community -- and people kept pasting large blocks of code directly into the chat. A fifty-line Python script would flood the conversation, pushing context off the screen for everyone else. IRC was designed for short text messages, not code dumps. Dixon's solution was straightforward: build a website where you could paste your code, get a short URL in return, and share that URL in the chat. The website would store the code, render it with syntax highlighting, and let anyone with the link read it. He called it Pastebin.com, and it became one of the most quietly influential web applications of the early 2000s. Within a few years, dozens of clones and alternatives appeared -- Hastebin (a minimalist keyboard-driven version), GitHub Gists (which added version control and user accounts to the paste concept), Pastie, Dpaste, and many others. The idea was so useful that it became a category: "pastebin" ceased to be a brand name and became a generic term for any service that stores and shares text snippets.

What makes Paste Bin an excellent system design topic -- and why interviewers love it -- is that it sits at a perfect intersection of simplicity and depth. On the surface, it sounds trivial: accept some text, store it, return a link. But the moment you start pulling at the threads, real engineering challenges emerge. How do you store potentially millions of text pastes efficiently? How do you handle pastes that range from a two-line snippet to a ten-megabyte log file? How do you serve popular pastes without melting your servers? How do you expire old content and reclaim storage? How do you prevent abuse -- spam, malware distribution, data exfiltration? Each of these questions maps directly to fundamental system design concepts: blob storage, caching, TTL-based expiration, abuse prevention, and content-addressable storage.

If you have already studied Topic 40 (Design a URL Shortener), Paste Bin is its natural successor. A URL shortener maps a short key to a URL -- a small piece of metadata, typically under a kilobyte. A Paste Bin maps a short key to arbitrary text content -- potentially megabytes of data. This single difference transforms the design. You can store URL mappings in a database row; you cannot efficiently store ten-megabyte pastes in database rows. You need blob storage, content hashing, compression, and a separation between metadata and content that the URL shortener did not require. The Paste Bin design forces you to think about the boundary between "data about the thing" and "the thing itself," which is one of the most important architectural distinctions in real-world systems. Every file-hosting service, every document editor, every media platform makes this same distinction, and mastering it here will serve you in every design that follows.

---

### Section 2 --- Requirements Gathering

Before drawing a single box on a whiteboard, you must establish what the system needs to do and how well it needs to do it. In an interview, this requirements-gathering phase is not a formality -- it is where you demonstrate that you think like an engineer rather than a coder. An engineer asks questions. A coder starts writing code. Interviewers notice the difference immediately.

**Functional Requirements**

The core functionality of a Paste Bin service includes the following capabilities. First, a user must be able to create a paste by submitting text content. The content could be anything -- a code snippet, a log file, a configuration block, prose, or raw data. The system assigns a unique short identifier (similar to a URL shortener key) and returns a URL that can be used to retrieve the paste. Second, anyone with the URL must be able to retrieve the paste and view its content. The retrieval should be fast, and the content should be rendered in a readable format, ideally with syntax highlighting for programming languages. Third, the creator of a paste should be able to optionally set an expiration time. A paste might expire in ten minutes (useful for sharing something ephemeral during a live debugging session), in a day, in a week, or never. After expiration, the paste becomes inaccessible and its storage can be reclaimed. Fourth, the system should support a visibility model: public pastes are discoverable through search or recent-pastes listings, unlisted pastes are accessible only to those who know the URL (similar to YouTube's unlisted videos), and private pastes are accessible only to the authenticated owner. Fifth, the system should support syntax highlighting for common programming languages. The user can specify the language when creating the paste, or the system can attempt auto-detection. Sixth, paste deletion should be supported -- either by the creator or through expiration. Optional features that a strong candidate might mention include paste forking (creating a copy to edit), version history, raw content download, and API access for programmatic usage.

**Non-Functional Requirements**

On the non-functional side, the system must deliver low-latency reads. When a user clicks a paste link, the content should appear within 200 milliseconds under normal conditions. This is critical because paste links are often shared in real-time conversations, and a slow-loading paste disrupts the flow of communication. The system must be highly available -- targeting 99.9% uptime or better. Paste Bin is not a life-critical system, but downtime is visible and erodes trust. Data durability is essential: once a paste is created (and has not expired), it must not be lost. Losing user content is one of the most damaging failures a storage service can experience. The system must handle large pastes gracefully. While the average paste is small, the system should support pastes up to 10 MB to accommodate large log files, database dumps, and other bulk text. Finally, the system must be resilient to abuse: rate limiting to prevent spam floods, content scanning to detect malware or illegal content, and size limits to prevent storage abuse.

**Back-of-Envelope Estimation**

Let us estimate the scale to inform our design decisions. Assume the service handles 5 million new pastes per day. This is a reasonable figure for a popular paste service -- Pastebin.com reported over 17 million unique monthly visitors at its peak, and a significant fraction of visitors create pastes. At 5 million pastes per day, that is approximately 58 paste creations per second on average, with peak loads likely 3 to 5 times higher during business hours in active time zones, so we should design for roughly 200 to 300 writes per second at peak.

For reads, paste services are heavily read-biased. A single paste might be shared in a chat room with hundreds of people, posted on a forum, or linked from a Stack Overflow answer. A conservative read-to-write ratio is 5:1, meaning 25 million paste reads per day, or roughly 290 reads per second on average and perhaps 1,000 to 1,500 reads per second at peak. Some viral pastes could generate thousands of reads per second on their own, which is why caching and CDN integration become essential.

For storage, assume the average paste size is 10 KB. Most pastes are short code snippets or configuration blocks, but the average is pulled up by occasional large log files and data dumps. At 5 million pastes per day and 10 KB per paste, that is 50 GB of new content per day. Over a year, that is approximately 18 TB of raw content. Over five years (a reasonable retention horizon), that is 90 TB of raw content. With compression (text compresses very well, typically achieving 3:1 to 10:1 ratios with gzip or zstd), actual storage might be 10 to 30 TB over five years. This is well within the capacity of modern object storage systems like Amazon S3, which can store exabytes of data.

For metadata, each paste has a metadata record of perhaps 500 bytes (IDs, timestamps, language, title, visibility settings, content hash, size). At 5 million pastes per day, that is 2.5 GB of new metadata per day, or roughly 4.5 TB over five years. This is small enough to fit comfortably in a relational database with proper indexing and partitioning.

Bandwidth estimation: at 25 million reads per day with an average paste size of 10 KB, outbound bandwidth is 250 GB per day, or approximately 23 Mbps sustained. At peak (5x average), that is around 115 Mbps. This is modest, but viral pastes can spike this dramatically, reinforcing the need for CDN offloading.

---

### Section 3 --- High-Level Architecture

With requirements and scale estimates in hand, we can sketch the high-level architecture. The central design decision -- and the one that distinguishes this from a URL shortener -- is the separation of metadata from content. Metadata (who created the paste, when, what language, when it expires) is small, structured, and queried frequently. Content (the actual text of the paste) is large, unstructured, and retrieved by key. These two types of data have fundamentally different storage characteristics, and treating them the same way leads to poor performance and inflated costs.

**API Design**

The external interface is a simple REST API with three primary endpoints.

`POST /api/pastes` accepts a JSON body containing the paste content, an optional title, an optional language identifier for syntax highlighting, a visibility setting (public, unlisted, or private), and an optional expiration duration. It returns a JSON response containing the generated paste ID and the full URL. The request must include authentication headers if the user wants the paste associated with their account; anonymous pastes are permitted but cannot be managed after creation.

`GET /api/pastes/:id` retrieves a paste by its unique identifier. It returns the paste metadata and content. If the paste has expired, the system returns a 410 Gone status. If the paste is private and the requester is not the owner, it returns a 403 Forbidden. For unlisted pastes, anyone with the ID can access it -- the secrecy of the ID is the access control mechanism.

`DELETE /api/pastes/:id` removes a paste. Only the paste owner (or an administrator) can delete a paste. This marks the paste as deleted in the metadata store and removes (or schedules removal of) the content from blob storage.

**Core Components**

The system is composed of six major components. The first is a fleet of **API servers** -- stateless application servers that handle incoming HTTP requests. These are horizontally scalable: add more servers behind a load balancer to handle more traffic. They validate input, enforce rate limits, generate paste IDs, coordinate writes to the metadata database and content store, and assemble responses.

The second component is the **metadata database**. This is a relational database (PostgreSQL or MySQL) storing structured information about each paste. Relational databases are ideal here because we need efficient queries by paste ID, expiration-based indexes for cleanup, and ACID transactions for consistent metadata updates. The metadata database does not store paste content.

The third component is the **content store** -- an object storage system like Amazon S3 or a compatible alternative (MinIO, Google Cloud Storage). This stores the actual text content of each paste as an object. Object storage is designed for exactly this workload: write-once, read-many, with variable object sizes, automatic replication, and eleven nines (99.999999999%) durability. Each paste's content is stored as a separate object, keyed by its content hash (more on this in the deep dive).

The fourth component is a **cache layer**, typically Redis or Memcached. The cache stores recently accessed paste metadata and content to reduce load on the database and content store. Given the read-heavy workload (5:1 ratio), caching is essential for acceptable performance at scale.

The fifth component is a **CDN** (Content Delivery Network) like CloudFront, Fastly, or Cloudflare. The CDN caches paste content at edge locations worldwide, reducing latency for geographically distributed users and offloading the vast majority of read traffic from the origin servers. Popular pastes -- those shared in forums, linked from documentation, or going viral on social media -- will be served almost entirely from CDN edge caches.

The sixth component is a set of **background workers** responsible for expiration processing, storage cleanup, abuse detection, and analytics aggregation. These run asynchronously and do not affect the latency of user-facing requests.

The request flow for creating a paste proceeds as follows: the client sends a POST request to the API server via the load balancer. The API server validates the input, generates a unique paste ID (using a similar mechanism to the URL shortener -- base62 encoding, nanoid, or a distributed ID generator), computes a hash of the content (SHA-256), compresses the content, uploads the compressed content to S3 with the content hash as the key, writes the metadata record to the database, and returns the paste URL to the client. The request flow for reading a paste is: the client requests the paste URL, the CDN checks its cache (cache hit returns immediately), on cache miss the request reaches the API server, which checks the Redis cache for metadata (and optionally content), on cache miss queries the database for metadata, retrieves the content from S3, decompresses it, caches the result, and returns it to the client through the CDN (which caches it for subsequent requests).

---

### Section 4 --- Deep Dive: Content Storage

The most consequential design decision in a Paste Bin system is how and where to store paste content. This is where the design diverges most sharply from a URL shortener, and it is the section where interviewers probe most deeply.

**Why Blob/Object Storage Over a Database**

The instinctive approach -- storing paste content in a TEXT or BLOB column alongside the metadata -- works at small scale but becomes problematic as the system grows. Relational databases are optimized for structured, fixed-size records with complex query patterns. Paste content is unstructured, highly variable in size (from a few bytes to 10 MB), and only ever accessed by a single key (the paste ID). Storing large content in the database inflates the database size, making backups slower, replicas larger, and queries on the metadata table slower because the database engine must manage rows of wildly varying sizes. Database pages that contain large blobs waste space and fragment the storage engine's memory. Furthermore, every read of paste content would hit the database, which is a shared resource also handling metadata queries, expiration scans, and analytics. A viral paste generating thousands of reads per second would compete for database connections with paste creation writes.

Object storage systems like Amazon S3 are purpose-built for this workload. S3 stores each object independently, scales horizontally without user intervention, provides eleven nines of durability through automatic replication across multiple data centers, and charges only for storage used and requests made. S3 supports range reads (reading part of an object), multipart uploads (for large pastes), and integrates natively with CDNs for edge caching. The cost difference is significant: storing 30 TB in S3 costs roughly $700 per month; storing 30 TB in a relational database requires expensive instance types with large attached storage and costs thousands per month, plus the operational burden of managing that database.

The trade-off is operational complexity. With content in the database, you have one system to back up, one system to monitor, one system to scale. With content in S3 and metadata in a database, you have two systems, and you must keep them consistent. If a metadata record points to an S3 object that does not exist (because the upload failed), the user sees an error. If an S3 object exists but its metadata record was deleted, you have orphaned storage that costs money. Handling these consistency edge cases is a real engineering challenge, and we will address it in the expiration and cleanup section.

**Content-Addressable Storage and Deduplication**

A powerful optimization for a paste service is content-addressable storage: instead of using the paste ID as the S3 key, use a hash of the content (SHA-256). When a user creates a paste, the system computes SHA-256 of the raw content. If an object with that hash already exists in S3, the system does not upload a duplicate -- it simply creates a new metadata record pointing to the existing content hash. This is deduplication, and it can save significant storage. In practice, popular code snippets, common configuration files, and standard error messages are pasted thousands of times. If ten thousand users paste the same "Hello World" program, the system stores the content once and creates ten thousand metadata records that all reference the same content hash.

The metadata record stores a `contentHash` field that serves as the foreign key into S3. The paste ID (in the URL) maps to a metadata record, which maps to a content hash, which maps to an S3 object. This indirection is what enables deduplication. It also means that deleting a paste does not necessarily mean deleting its content from S3 -- you must check whether other metadata records still reference the same content hash. This reference-counting requirement is a trade-off: deduplication saves storage but complicates deletion.

The implementation uses SHA-256 because it is cryptographically secure (collision resistance makes accidental duplicates effectively impossible) and widely supported. The hash is computed before compression, on the raw content, so that identical content always produces the same hash regardless of compression settings or algorithm changes.

**Compression Strategies**

Text content compresses extraordinarily well. A typical code file achieves 3:1 to 5:1 compression with gzip and 4:1 to 8:1 with zstd (Zstandard), which was designed by Facebook specifically for this class of workload. For a system storing 50 GB of new content per day, compression at 5:1 reduces that to 10 GB per day -- a five-year savings of 60 TB of storage and the corresponding cost reduction.

The system should compress content before uploading to S3 and decompress on read. The compression algorithm and level should be recorded in the metadata so that the system can correctly decompress content even if the default algorithm changes in the future. Zstd is the recommended choice for new systems because it offers better compression ratios than gzip at equivalent CPU cost and supports dictionary-based compression, which is particularly effective for code content because programming languages have highly repetitive syntax.

The CPU cost of compression is a real trade-off. At the paste creation rate of 200 to 300 writes per second at peak, with average paste sizes of 10 KB, the compression workload is modest -- zstd compresses 10 KB in under a millisecond on modern hardware. But for large pastes (approaching 10 MB), compression can take tens of milliseconds, which adds latency to the paste creation flow. For large pastes, using a lower compression level (faster but less compact) is a reasonable trade-off, since a few extra kilobytes of storage cost less than user-perceptible latency.

**Chunking for Large Pastes**

While most pastes are small, the system must handle pastes up to 10 MB. For these large pastes, chunking provides several benefits. The content is split into fixed-size chunks (say, 1 MB each), each chunk is compressed and uploaded to S3 independently, and the metadata record stores an ordered list of chunk hashes. This enables resumable uploads (if the connection drops after uploading 7 of 10 chunks, only the remaining 3 need to be retried), parallel uploads and downloads (multiple chunks can be transferred simultaneously), and per-chunk deduplication (if two large pastes share common sections, those chunks are stored only once). However, chunking adds complexity and is only beneficial for large pastes. A reasonable implementation uses chunking only for pastes above a threshold (say, 1 MB) and stores smaller pastes as a single object. This keeps the common case simple while handling the edge case gracefully.

---

### Section 5 --- Database Design

The metadata database is the backbone of the system's coordination layer. It does not store paste content, but it stores everything the system needs to know about each paste: who created it, when, how to find its content, and when to expire it.

**Metadata Schema**

The primary table is `pastes`, with the following columns:

```
pastes
------------------------------------------------------
paste_id        VARCHAR(12)   PRIMARY KEY    -- Base62-encoded unique ID (appears in URL)
user_id         VARCHAR(36)   NULLABLE       -- UUID of the creator (NULL for anonymous pastes)
title           VARCHAR(255)  NULLABLE       -- Optional user-provided title
language        VARCHAR(50)   DEFAULT 'text' -- Syntax highlighting language
visibility      ENUM('public', 'unlisted', 'private')  DEFAULT 'unlisted'
created_at      TIMESTAMP     NOT NULL       -- Creation timestamp (UTC)
expires_at      TIMESTAMP     NULLABLE       -- Expiration timestamp (NULL = never expires)
content_hash    CHAR(64)      NOT NULL       -- SHA-256 hex digest of raw content
size_bytes      INT           NOT NULL       -- Raw content size in bytes
is_deleted      BOOLEAN       DEFAULT FALSE  -- Soft-delete flag
```

Several design decisions are embedded in this schema. The `paste_id` is a short, URL-safe string generated using base62 encoding (a-z, A-Z, 0-9). With 8 characters, base62 provides 62^8 = 218 trillion possible IDs, far more than needed for five years at 5 million pastes per day (approximately 9 billion pastes total). The `user_id` is nullable because anonymous pastes are a core feature -- many users paste content without creating an account. The `content_hash` is the link between the metadata database and S3: to retrieve content, the system reads the metadata row, extracts the content hash, and requests that key from S3. The `is_deleted` flag enables soft deletion, which is important for both abuse investigation and safe cleanup of deduplicated content.

**Indexes**

The following indexes are critical for performance:

The primary key index on `paste_id` supports the most common query: retrieving a paste by its ID. This is the hot path for every paste read.

A composite index on `(expires_at, is_deleted)` supports the expiration cleanup worker, which periodically queries for pastes where `expires_at < NOW() AND is_deleted = FALSE`. Without this index, the cleanup query would scan the entire table.

An index on `user_id` supports the "my pastes" query for authenticated users who want to see their paste history. This is a secondary access pattern but important for user experience.

An index on `content_hash` supports the deduplication check: before uploading content to S3, the system can quickly check whether another metadata record already references the same content hash. This index also supports the reference-counting query during deletion: before deleting an S3 object, verify that no other metadata records reference it.

An index on `(visibility, created_at)` supports the "recent public pastes" listing, if the system offers a discovery feature.

**Why SQL for Metadata**

The choice of a relational database (PostgreSQL or MySQL) for metadata is deliberate. The metadata workload consists of single-row lookups by primary key (fast with any database), range scans for expiration processing (well-served by B-tree indexes in relational databases), and transactional updates for soft deletion and status changes (ACID guarantees prevent inconsistent states). The data is structured and uniform -- every paste has the same fields -- which is a natural fit for a relational schema. The total metadata volume (roughly 4.5 TB over five years) is well within the capacity of a single relational database instance with partitioning, or a modestly sharded cluster.

NoSQL alternatives like DynamoDB or Cassandra would also work for the simple key-value lookup pattern, but they offer less natural support for the expiration scan query (which is a range scan on a non-partition key) and provide weaker consistency guarantees for transactional updates. For a system of this scale, the relational model's query flexibility and consistency guarantees outweigh the scaling advantages of NoSQL.

**Content Storage in S3**

The content storage in S3 uses the SHA-256 content hash as the object key. The objects are organized in a bucket with a prefix structure based on the first few characters of the hash to avoid hot-partition issues in S3's internal indexing:

```
s3://paste-content/{first-2-chars}/{next-2-chars}/{full-hash}.zst
```

For example, a paste with content hash `a3f2b1...` would be stored at `s3://paste-content/a3/f2/a3f2b1....zst`. The `.zst` extension indicates zstd compression. This prefix structure ensures even distribution of objects across S3's internal partitions and avoids the performance degradation that can occur when millions of objects share a common prefix. Each S3 object stores the compressed paste content plus metadata headers indicating the compression algorithm and the raw content size, enabling the retrieval layer to decompress correctly.

---

### Section 6 --- Caching and Performance

At 25 million reads per day (roughly 1,000 to 1,500 reads per second at peak), serving every request from the database and S3 would work but would be wasteful and slow. Paste access patterns are highly skewed: a small number of popular pastes receive the vast majority of reads, while millions of pastes are created, read once by the recipient, and never accessed again. This skew makes caching extraordinarily effective.

**CDN for Popular Pastes**

The CDN is the first and most impactful caching layer. When a paste URL is requested, the CDN checks its edge cache. If the paste content is cached at the edge location nearest the user, the response is returned in single-digit milliseconds with zero load on the origin servers. For popular pastes -- those linked from forums, documentation, or social media -- the CDN cache hit rate can exceed 95%, meaning only 5% of requests for those pastes reach the origin.

The CDN cache key is the paste ID. The cache TTL should be set conservatively -- perhaps 5 minutes for mutable content or 24 hours for immutable content. Since pastes are immutable after creation (their content does not change), a long TTL is appropriate. The exception is deleted or expired pastes, which must be purged from the CDN cache. This is handled via cache invalidation: when a paste is deleted or expires, the system sends an invalidation request to the CDN, which purges the content from all edge locations. CDN invalidation is eventually consistent (it can take seconds to propagate globally), so there is a brief window where deleted pastes might still be served from edge caches. For most use cases, this is acceptable.

**Redis Cache for Metadata**

Behind the CDN, a Redis cache stores recently accessed paste metadata. When a request reaches the API server (because the CDN did not have the content cached), the server first checks Redis for the paste's metadata. A Redis lookup takes under a millisecond; a database query takes 1 to 5 milliseconds. At 1,500 reads per second, this difference multiplied across all requests adds up significantly in terms of database load reduction.

The Redis cache uses the paste ID as the key and the serialized metadata record as the value. The TTL is set based on the paste's expiration time: if the paste expires in one hour, the Redis TTL is one hour. If the paste never expires, the Redis TTL is set to a reasonable default (say, 24 hours) to prevent the cache from growing unboundedly. Cache invalidation is straightforward: when a paste is deleted, the system explicitly deletes the Redis key.

**Content Cache Strategy**

Caching paste content in memory is more nuanced because content can be large. A 10 MB paste consumes 10 MB of Redis memory, which is expensive at scale. The strategy is tiered. For small pastes (under 100 KB, which constitutes the vast majority), content can be cached in Redis alongside metadata. For medium pastes (100 KB to 1 MB), content can be cached in a separate Redis cluster with a shorter TTL and an LRU eviction policy. For large pastes (over 1 MB), content is not cached in Redis at all -- it is served directly from S3, which is optimized for this access pattern, potentially with the CDN caching the rendered response.

An alternative approach is to skip Redis content caching entirely and rely on the CDN and S3's own caching layer (S3 has internal caching for frequently accessed objects). This simplifies the architecture at the cost of slightly higher latency for cache-miss reads. In an interview, mentioning both approaches and explaining the trade-off demonstrates maturity.

**Lazy Loading vs. Eager Loading**

When serving a paste, the system can use lazy loading (fetch metadata first, then fetch content on demand) or eager loading (fetch both in parallel or pre-assembled). Lazy loading is simpler and works well for API responses where the client might only need metadata (for example, to display the paste title and language before rendering the content). Eager loading is better for full-page renders where both metadata and content are always needed. A practical hybrid approach is to always lazy-load at the API server level (fetch metadata from Redis/database, then fetch content from Redis/S3) but use the CDN to cache the fully assembled response so that subsequent requests get everything in one shot.

**Cache Invalidation on Deletion and Expiration**

Cache invalidation is the classic hard problem. For a Paste Bin service, the invalidation cases are well-defined: a paste can be explicitly deleted by its owner, or it can expire based on its TTL. In both cases, the invalidation flow is: (1) mark the paste as deleted in the database, (2) delete the Redis cache entry, (3) send a CDN invalidation request. If any of these steps fails, the system uses an eventual consistency model: the cache entries will expire on their own based on their TTLs, ensuring that stale content is not served indefinitely. For pastes that are deleted for legal or abuse reasons, stronger invalidation guarantees may be needed -- the system can actively purge CDN caches and verify the purge completed before confirming deletion to the requester.

---

### Section 7 --- Scaling and Reliability

A Paste Bin service at the scale we have estimated (5 million writes per day, 25 million reads per day) is not extraordinarily large by modern standards, but it requires deliberate scaling decisions to remain reliable as it grows.

**Horizontal Scaling of API Servers**

The API servers are stateless -- they hold no per-request state between requests, and any server can handle any request. This makes horizontal scaling straightforward: add more servers behind the load balancer when traffic increases, remove them when it decreases. Auto-scaling groups in cloud environments handle this automatically, scaling based on CPU utilization, request count, or latency metrics. The load balancer distributes requests using round-robin or least-connections algorithms. Health checks ensure that unhealthy servers are removed from the pool within seconds.

**Database Sharding by Paste ID**

At some point, a single database instance cannot handle the write throughput or storage volume. The natural sharding key is the paste ID, because the overwhelmingly dominant access pattern is single-row lookup by paste ID. The system can use hash-based sharding: apply a hash function to the paste ID and use the result modulo the number of shards to determine which shard stores that paste's metadata. This distributes data evenly across shards and ensures that any paste can be located in a single shard with no cross-shard queries for the primary access pattern.

The expiration cleanup query is more complex under sharding because it requires scanning all shards for expired pastes. This is handled by running the cleanup worker against each shard independently, which parallelizes naturally. The "recent public pastes" listing also requires cross-shard queries, but this is a low-priority feature that can be served from a denormalized read replica or an auxiliary index.

Read replicas are valuable even before sharding becomes necessary. The read-heavy workload (5:1 ratio) means that most database load is from reads, and read replicas can absorb this load without affecting write performance on the primary. Each API server reads from the nearest replica and writes to the primary. Replication lag (typically under one second for well-configured PostgreSQL streaming replication) means that a paste might not be readable from a replica for a brief period after creation, but this is acceptable for a paste service.

**S3's Built-in Durability and Replication**

One of the strongest arguments for using S3 for content storage is that durability and replication are built in and require no operational effort. S3 automatically replicates objects across multiple availability zones within a region, providing eleven nines of durability. This means that if you store one billion objects, you can expect to lose one object every ten years. For cross-region redundancy, S3 Cross-Region Replication can be enabled, which asynchronously copies objects to a bucket in another region. This protects against an entire region failure, which is exceedingly rare but not impossible.

S3 also scales transparently. There is no capacity planning, no provisioning, no sharding configuration. The system simply writes objects and reads them, and S3 handles the rest. This operational simplicity is a significant advantage over alternatives like running your own distributed file system.

**Rate Limiting Paste Creation**

Without rate limiting, a single malicious or misconfigured client can flood the system with paste creation requests, consuming storage, database capacity, and potentially generating significant cost. Rate limiting should be applied at multiple levels. At the API gateway or load balancer level, limit total requests per IP address (for example, 10 paste creations per minute per IP). For authenticated users, limit based on user ID (perhaps 60 paste creations per minute). For anonymous users, apply stricter limits (5 paste creations per minute per IP). Rate limiting implementation is the subject of Topic 42, but at a high level, a token bucket or sliding window counter stored in Redis provides efficient, distributed rate limiting.

**Abuse Prevention**

Paste services are frequent targets for abuse. Spammers use them to host phishing pages, malware distributors use them to host encoded payloads, and data thieves use them to exfiltrate sensitive data. Prevention strategies include content scanning (using pattern matching or machine learning to detect known malware signatures, phishing URLs, and spam patterns), size limits (10 MB maximum per paste, with stricter limits for anonymous users), CAPTCHA for anonymous paste creation at high rates, and human review queues for flagged content. These measures add latency and complexity to the paste creation flow, so they should be applied judiciously -- heavy scanning on every paste creation is expensive, while lightweight pattern matching followed by asynchronous deep scanning of flagged content balances security with performance.

---

### Section 8 --- Expiration and Cleanup

Paste expiration is not merely a user-facing feature; it is an operational necessity. Without expiration and cleanup, the system's storage grows monotonically, costs increase without bound, and the database accumulates an ever-growing tail of stale data that slows queries and complicates maintenance. A well-designed expiration system keeps the service lean and cost-effective.

**TTL-Based Expiration**

When a user creates a paste with an expiration time, the system computes the absolute expiration timestamp (`expires_at = created_at + duration`) and stores it in the metadata record. The paste remains accessible until this timestamp is reached. After expiration, the paste should return a 410 Gone response, and its resources should be reclaimed.

The expiration check can happen in two ways: at read time (lazy) or proactively (eager). Lazy expiration checks the `expires_at` field when a paste is requested. If the paste has expired, the system returns 410 Gone and optionally marks it for cleanup. This is simple and adds no background processing, but it means expired pastes continue to consume storage until someone tries to access them. Some expired pastes may never be accessed again, so they sit in storage indefinitely. Eager expiration uses background workers that periodically scan for expired pastes and clean them up. A worker runs a query like `SELECT paste_id, content_hash FROM pastes WHERE expires_at < NOW() AND is_deleted = FALSE LIMIT 1000`, processes each result (marking it as deleted and scheduling content removal), and repeats. This ensures timely cleanup but adds operational complexity.

In practice, the best approach combines both strategies. Every read checks expiration (for immediate user-facing correctness) and background workers handle bulk cleanup (for storage reclamation). The background worker should run frequently (every few minutes) and process pastes in batches to avoid overwhelming the database or S3.

**Background Cleanup Workers**

The cleanup worker performs a multi-step process for each expired paste. First, it marks the paste's `is_deleted` flag as true in the database. Second, it checks whether other non-deleted pastes reference the same `content_hash`. This is the reference-counting step required by content-addressable storage. The query is: `SELECT COUNT(*) FROM pastes WHERE content_hash = :hash AND is_deleted = FALSE AND paste_id != :current_paste_id`. If the count is zero, no other paste uses this content, and the S3 object can be safely deleted. If the count is greater than zero, the content is still in use, and only the metadata record is marked as deleted. Third, if the S3 object can be deleted, the worker issues a delete request to S3. Fourth, the worker invalidates any Redis cache entries and sends CDN purge requests for the expired paste ID.

This multi-step process has failure modes at each step. If the worker crashes between marking the metadata as deleted and deleting the S3 object, the content becomes orphaned -- it exists in S3 but no active metadata record references it. Orphaned content wastes storage but does not cause functional errors. A separate orphan-detection job can periodically reconcile S3 objects against database records and delete any S3 objects that have no corresponding active metadata record. This reconciliation job is expensive (it must enumerate all S3 objects and cross-reference them against the database) and should run infrequently, perhaps weekly.

**Lazy Deletion vs. Eager Deletion**

Lazy deletion (soft delete via the `is_deleted` flag) is preferred over eager deletion (hard deleting database rows) for several reasons. Soft-deleted records can be undeleted if the deletion was accidental or if a legal request requires retention. Soft-deleted records provide an audit trail for abuse investigation. Soft-deleted records enable the reference-counting mechanism for deduplicated content without race conditions -- if a row were hard-deleted, the reference count could become inaccurate if two concurrent deletion operations both checked the count before either completed. The downside is that soft-deleted rows continue to occupy database space. A periodic archival job can move soft-deleted records older than a configurable retention period (say, 30 days) to cold storage or delete them permanently, freeing database space.

**Storage Reclamation Strategies**

Over time, even with expiration and cleanup, storage can accumulate in unexpected ways. Content that was deduplicated and shared by many pastes may eventually become orphaned as all referring pastes expire one by one, but the reference-counting check during each individual paste's cleanup found other references still active. Only after the last referring paste expires is the content truly orphaned, and by that time, the cleanup worker for that last paste handles the deletion. This works correctly but requires careful implementation to avoid race conditions. Two cleanup workers processing the last two references simultaneously might both find a count of 1, both decide not to delete, and the content becomes permanently orphaned. This race condition can be prevented by using a database transaction with a row-level lock when performing the reference count check and the delete decision.

---

### Section 9 --- Trade-Offs and Design Decisions

Every design is a collection of trade-offs. In an interview, articulating these trade-offs clearly -- explaining what you gain and what you give up with each decision -- is what distinguishes a strong candidate from one who merely describes a solution.

**Blob Storage vs. Database for Content**

We chose S3 for content and a relational database for metadata. The alternative -- storing everything in the database -- is simpler operationally (one system to manage) and provides transactional consistency (metadata and content are written atomically). The drawbacks are significant: the database becomes bloated with large text blobs, query performance degrades as table sizes grow, backup and replication become slower, and the cost per gigabyte is much higher than object storage. For a small-scale paste service (thousands of pastes per day), the all-in-database approach is perfectly reasonable and avoids premature optimization. For the scale we are designing (millions per day), the separation is necessary. This is a classic example of an architecture that should evolve with scale rather than being over-engineered from the start.

**Deduplication Trade-Offs**

Content-addressable storage with deduplication saves storage -- potentially 10 to 30% for a paste service, depending on the user base -- but adds complexity. The reference-counting mechanism for safe deletion is error-prone and introduces race conditions. The content hash computation adds CPU overhead to every paste creation. The indirection layer (paste ID maps to metadata, which maps to content hash, which maps to S3 object) adds latency and debugging complexity. For a startup building a paste service, skipping deduplication entirely and using the paste ID as the S3 key is a defensible decision. The storage savings are not worth the engineering complexity until the system reaches a scale where storage cost is a significant line item.

**Public vs. Private Paste Security Model**

The three-tier visibility model (public, unlisted, private) serves different use cases but has different security implications. Public pastes are discoverable and indexable -- they need no access control but may expose sensitive content if users mistakenly choose this option. Unlisted pastes rely on the secrecy of the URL for access control. With 8-character base62 IDs, there are 218 trillion possible IDs, making random guessing impractical. But if paste IDs are sequential or predictable, an attacker could enumerate them. Using random IDs (generated by a cryptographically secure random number generator, not a counter) is essential. Private pastes require authentication and authorization checks on every access, which adds latency but provides true access control. The trade-off is between user convenience (unlisted pastes require no login to view) and security (private pastes guarantee that only the owner can access them).

**Syntax Highlighting: Server-Side vs. Client-Side**

Syntax highlighting can be performed on the server (rendering highlighted HTML before sending it to the client) or on the client (sending raw text and using a JavaScript library like Prism.js or highlight.js to highlight it in the browser). Server-side highlighting reduces client complexity and works for clients that do not support JavaScript (API consumers, curl, bots), but it increases server CPU usage, makes the response larger (highlighted HTML is much larger than raw text), and complicates caching (the highlighted version depends on the language, the theme, and the highlighting library version). Client-side highlighting keeps the server simple (it serves raw text), produces smaller responses that cache better, and allows users to choose their preferred theme, but it requires JavaScript and adds to page load time. The pragmatic choice is client-side highlighting for the web UI (with raw text available via the API) and optional server-side highlighting for the API as a query parameter.

**Compression vs. CPU Cost**

Compressing paste content before storage reduces storage costs and network bandwidth but adds CPU time to every write (compression) and read (decompression). For small pastes, the CPU time is negligible (under a millisecond). For large pastes, it can reach tens of milliseconds. The trade-off is quantifiable: measure the storage savings and cost reduction against the CPU cost and latency increase. For a text-heavy service, compression is almost always worthwhile because text compresses so well (3:1 to 10:1). The compression level can be tuned: higher levels produce smaller output but take more CPU time. A reasonable default is zstd level 3 (fast, good compression) for real-time paste creation and zstd level 9 (slower, better compression) for a background recompression job that optimizes storage for pastes that survive beyond a threshold age.

---

### Section 10 --- Interview Questions

**Beginner Tier**

**Question 1: How does a Paste Bin differ from a URL shortener, and why does this matter for the system design?**

What the interviewer is testing: Whether you understand that content storage is the fundamental difference and can articulate how it affects every layer of the architecture.

A weak answer mentions that Paste Bin stores text while a URL shortener stores URLs, then proceeds to design them the same way. A strong answer explains the cascading implications. A URL shortener stores metadata that is a few hundred bytes per entry -- it fits comfortably in a database row, can be cached entirely in Redis, and never needs blob storage. A Paste Bin stores content that ranges from a few bytes to 10 MB per entry. This variable and potentially large content size means you need to separate metadata from content, use object storage (like S3) for content, implement compression to reduce storage costs, handle chunking for large pastes, and design a tiered caching strategy that accounts for content size. The URL shortener's hot path is a database lookup and a redirect. The Paste Bin's hot path is a database lookup for metadata, an S3 fetch for content, decompression, and rendering. Every layer of the system is affected by the presence of large, variable-size content. A candidate who articulates these cascading effects demonstrates genuine understanding rather than pattern-matching.

**Question 2: Walk me through what happens when a user creates a paste, step by step.**

What the interviewer is testing: Whether you understand the end-to-end write flow, including all the components involved and the ordering of operations.

A strong answer walks through the entire flow with precision. The client sends a POST request to the API endpoint with the paste content, language, visibility, and optional expiration time. The load balancer routes the request to one of the API servers. The API server validates the input: checks content size (rejects if over 10 MB), validates the language identifier, checks the visibility setting, and verifies rate limits. The server generates a unique paste ID using a cryptographically secure random generator encoded in base62. It computes the SHA-256 hash of the raw content. It checks whether an S3 object with that hash already exists (for deduplication). If not, it compresses the content using zstd and uploads it to S3 with the content hash as the key. It then writes the metadata record to the database (paste ID, user ID, title, language, visibility, created_at, expires_at, content hash, size). Finally, it returns the paste URL to the client. The candidate should mention that the S3 upload should happen before the database write: if S3 upload fails, we do not create a metadata record pointing to nonexistent content. If the database write fails after the S3 upload, we have orphaned content, which is wasteful but not functionally incorrect and can be cleaned up by the orphan-detection job.

**Question 3: Why would you use S3 instead of storing paste content directly in your database?**

What the interviewer is testing: Whether you understand the practical trade-offs between different storage systems, not just theoretical knowledge.

A weak answer says "S3 is cheaper" and stops. A strong answer covers multiple dimensions. Cost: S3 charges approximately $0.023 per GB per month; equivalent database storage (RDS gp3) costs roughly $0.08 per GB per month, plus the instance cost. At 30 TB of content, this difference is thousands of dollars per month. Performance: large blobs in a relational database inflate row sizes, cause table fragmentation, slow down backups and replicas, and compete for the database's connection pool with metadata queries. A viral paste generating thousands of reads per second would saturate the database. S3 is designed for exactly this workload and scales transparently. Durability: S3 provides eleven nines of durability out of the box, with automatic cross-AZ replication. Achieving similar durability in a self-managed database requires significant operational effort. Integration: S3 integrates natively with CDNs for edge caching. The trade-off is operational complexity -- two systems instead of one -- and consistency concerns between metadata and content.

**Mid Tier**

**Question 4: How would you handle deduplication of paste content? What are the trade-offs?**

What the interviewer is testing: Whether you can design a content-addressable storage system and reason about its trade-offs.

A strong answer explains the mechanism: compute SHA-256 of the raw content, use this hash as the S3 key, and store the hash in the metadata record. When a new paste is created, check if an S3 object with that hash already exists. If it does, skip the upload and just create a metadata record pointing to the existing content. This saves storage (identical pastes share one copy) and bandwidth (no redundant uploads). The trade-offs are: (1) deletion becomes complex because you must reference-count before deleting S3 objects -- if other pastes still reference the same content hash, you cannot delete the S3 object; (2) there is a race condition when two deletion workers simultaneously process the last two references to the same content hash; (3) the hash computation adds CPU time to every write; (4) debugging is harder because the paste ID does not directly correspond to the S3 key. The candidate should mention that deduplication is an optimization, not a necessity, and should be deferred until storage cost is a significant concern.

**Question 5: How would you design the expiration system? What happens to expired pastes?**

What the interviewer is testing: Whether you can design a background processing system that handles data lifecycle management.

A strong answer describes the dual approach: lazy expiration (check `expires_at` on every read and return 410 Gone if expired) for immediate correctness, combined with eager expiration via background workers for storage reclamation. The background worker periodically queries the database for expired pastes (`expires_at < NOW() AND is_deleted = FALSE`), processes them in batches, marks metadata as deleted, performs reference-counting to determine if S3 content can be deleted, issues S3 deletes for unreferenced content, and invalidates caches. The candidate should discuss the ordering of operations (mark metadata first, then delete content, to avoid serving deleted content), the batch size and frequency of the worker (small batches, frequent runs, to avoid spiky load), and the orphan-detection job for content that becomes unreferenced due to worker failures.

**Question 6: A paste goes viral and is receiving 50,000 reads per second. How does your system handle this?**

What the interviewer is testing: Whether you understand how caching layers absorb traffic spikes.

A strong answer traces the request path under this load. The CDN is the first line of defense: after the first request populates the CDN cache, the remaining 49,999 requests per second are served from the CDN edge with no load on the origin. The CDN cache TTL for immutable paste content should be long (hours or days). If, for some reason, the CDN cache is not populated (cold start, cache eviction, or a CDN misconfiguration), the requests hit the API servers. Redis absorbs the metadata lookup load (sub-millisecond). For content, the Redis content cache absorbs reads for small pastes; for larger pastes, S3 handles the load because it is designed for high-throughput reads. The API servers themselves are stateless and horizontally scaled, so 50,000 requests per second is distributed across the fleet. The candidate should mention that without a CDN, 50,000 RPS would be a serious challenge even for a well-provisioned origin, and that CDN integration is not optional for a production paste service.

**Senior Tier**

**Question 7: How would you design the system to handle a multi-region deployment with low latency worldwide?**

What the interviewer is testing: Whether you can reason about data replication, consistency, and latency in a globally distributed system.

A strong answer recognizes that the paste workload -- write once, read many, immutable content -- is ideally suited for multi-region deployment. Content in S3 can be replicated across regions using S3 Cross-Region Replication, with reads served from the nearest region. The CDN already provides edge caching globally, which handles the majority of reads. The metadata database is the harder problem: a single-region primary with read replicas in other regions provides eventual consistency for reads with low latency, but paste creation must go to the primary region (adding latency for users far from the primary). An alternative is a multi-master database (like CockroachDB or Spanner), which allows writes in any region but adds complexity and cost. For a paste service, the pragmatic choice is a single-region primary (most users will not notice the write latency for paste creation, which is an infrequent operation) with multi-region read replicas and CDN for low-latency reads.

**Question 8: How would you ensure consistency between the metadata database and S3 content store?**

What the interviewer is testing: Whether you understand the consistency challenges of a two-system architecture and can design mitigation strategies.

A strong answer identifies the two failure modes: metadata exists but content does not (broken paste), and content exists but metadata does not (orphaned storage). For the first case, the write flow should upload content to S3 first, then write metadata. If S3 upload succeeds but the metadata write fails, we have orphaned content (benign, cleaned up by the orphan-detection job). If we wrote metadata first and S3 upload failed, we would have a broken paste (users see an error), which is worse. For the second case, the orphan-detection job periodically scans S3 and compares against database records. This is a reconciliation pattern common in distributed systems. The candidate should also mention idempotent retries: if the API server crashes after uploading to S3 but before writing metadata, the client retries the entire request. The S3 upload is idempotent (uploading the same content with the same key overwrites with the same data), and the metadata write uses the paste ID as the primary key (which is idempotent on INSERT with an ON CONFLICT clause). Thus the retry produces the correct result without duplicates.

**Question 9: Design a system to detect and prevent abuse on the paste service at scale.**

What the interviewer is testing: Whether you can think about security and abuse prevention as a system design problem, not just an afterthought.

A strong answer describes a multi-layered approach. The first layer is rate limiting: per-IP and per-user limits on paste creation, with stricter limits for anonymous users. The second layer is content scanning: synchronous lightweight checks during paste creation (regex patterns for known malware signatures, phishing URLs, credit card numbers) and asynchronous deep scanning for flagged content (machine learning classifiers, external threat intelligence feeds). The third layer is reputation scoring: track the history of each IP and user account, assigning a reputation score based on the ratio of flagged-to-clean pastes. Low-reputation actors get stricter rate limits and mandatory CAPTCHA challenges. The fourth layer is reporting and moderation: allow users to report abusive pastes, feed reports into the reputation system, and escalate to human moderators for ambiguous cases. The candidate should discuss the trade-offs: aggressive scanning adds latency and CPU cost to paste creation, false positives block legitimate content, and determined abusers will adapt to detection patterns. The system should err on the side of allowing content through (with asynchronous scanning) rather than blocking legitimate users with overly aggressive synchronous checks.

---

### Section 11 --- Complete Code Example

This section provides both pseudocode for the system design overview and a concrete Node.js implementation of the core Paste Bin service. The pseudocode captures the architectural intent; the Node.js code demonstrates a working implementation with content hashing, S3 storage, metadata management, and expiration handling.

**Pseudocode Design**

```
SYSTEM PasteBinService

COMPONENT APIServer:
    FUNCTION createPaste(content, title, language, visibility, expiresIn, userId):
        // Step 1: Validate input
        IF length(content) > MAX_PASTE_SIZE:          // MAX_PASTE_SIZE = 10MB
            RETURN error(413, "Content too large")
        IF NOT isValidLanguage(language):
            SET language = "text"                      // Default to plain text
        IF NOT isValidVisibility(visibility):
            SET visibility = "unlisted"                // Default to unlisted

        // Step 2: Check rate limits
        IF NOT rateLimiter.allow(userId OR clientIP):
            RETURN error(429, "Rate limit exceeded")

        // Step 3: Generate unique paste ID
        SET pasteId = generateSecureRandomBase62(8)    // 8-char random base62 string

        // Step 4: Compute content hash for deduplication
        SET contentHash = SHA256(content)              // Hash raw content before compression
        SET sizeBytes = length(content)

        // Step 5: Upload content to S3 (if not already present)
        IF NOT objectStore.exists(contentHash):
            SET compressed = zstdCompress(content, level=3)
            objectStore.put(contentHash, compressed, metadata={
                algorithm: "zstd",
                rawSize: sizeBytes
            })

        // Step 6: Compute expiration timestamp
        SET expiresAt = NULL
        IF expiresIn IS NOT NULL:
            SET expiresAt = NOW() + expiresIn

        // Step 7: Write metadata to database
        database.insert("pastes", {
            paste_id: pasteId,
            user_id: userId,
            title: title,
            language: language,
            visibility: visibility,
            created_at: NOW(),
            expires_at: expiresAt,
            content_hash: contentHash,
            size_bytes: sizeBytes,
            is_deleted: FALSE
        })

        // Step 8: Return the paste URL
        RETURN { pasteId: pasteId, url: BASE_URL + "/" + pasteId }

    FUNCTION getPaste(pasteId, requestingUserId):
        // Step 1: Check cache for metadata
        SET metadata = cache.get("paste:" + pasteId)
        IF metadata IS NULL:
            SET metadata = database.findById("pastes", pasteId)
            IF metadata IS NULL:
                RETURN error(404, "Paste not found")
            cache.set("paste:" + pasteId, metadata, ttl=3600)

        // Step 2: Check if paste is deleted or expired
        IF metadata.is_deleted:
            RETURN error(410, "Paste has been deleted")
        IF metadata.expires_at IS NOT NULL AND metadata.expires_at < NOW():
            RETURN error(410, "Paste has expired")

        // Step 3: Check visibility permissions
        IF metadata.visibility == "private" AND requestingUserId != metadata.user_id:
            RETURN error(403, "Access denied")

        // Step 4: Retrieve content from cache or S3
        SET content = cache.get("content:" + metadata.content_hash)
        IF content IS NULL:
            SET compressed = objectStore.get(metadata.content_hash)
            SET content = zstdDecompress(compressed)
            IF metadata.size_bytes < 100_000:         // Cache small pastes only
                cache.set("content:" + metadata.content_hash, content, ttl=3600)

        // Step 5: Return paste data
        RETURN { metadata: metadata, content: content }

    FUNCTION deletePaste(pasteId, requestingUserId):
        SET metadata = database.findById("pastes", pasteId)
        IF metadata IS NULL OR metadata.is_deleted:
            RETURN error(404, "Paste not found")
        IF requestingUserId != metadata.user_id:
            RETURN error(403, "Access denied")

        // Soft-delete the metadata record
        database.update("pastes", pasteId, { is_deleted: TRUE })

        // Invalidate caches
        cache.delete("paste:" + pasteId)
        cdn.purge(BASE_URL + "/" + pasteId)

        // Schedule content cleanup (handled by background worker)
        cleanupQueue.enqueue({ contentHash: metadata.content_hash })

        RETURN { success: TRUE }

COMPONENT ExpirationWorker:
    FUNCTION run():                                    // Runs every 60 seconds
        SET expiredPastes = database.query(
            "SELECT paste_id, content_hash FROM pastes
             WHERE expires_at < NOW() AND is_deleted = FALSE
             LIMIT 500"
        )
        FOR EACH paste IN expiredPastes:
            database.update("pastes", paste.paste_id, { is_deleted: TRUE })
            cache.delete("paste:" + paste.paste_id)
            cdn.purge(BASE_URL + "/" + paste.paste_id)
            cleanupQueue.enqueue({ contentHash: paste.content_hash })

COMPONENT ContentCleanupWorker:
    FUNCTION processCleanup(contentHash):
        // Reference count: how many non-deleted pastes still use this content?
        SET refCount = database.query(
            "SELECT COUNT(*) FROM pastes
             WHERE content_hash = :contentHash AND is_deleted = FALSE",
            { contentHash: contentHash }
        )
        IF refCount == 0:
            objectStore.delete(contentHash)            // Safe to delete from S3
            cache.delete("content:" + contentHash)
```

The pseudocode above captures the essential logic of the three main operations (create, read, delete) and the two background workers (expiration and content cleanup). Each step is annotated with its purpose, and the ordering of operations is deliberate: content is uploaded before metadata is written (to avoid broken references), and soft deletion is performed before content cleanup (to ensure that concurrent reads see the paste as deleted before the content is removed).

**Node.js Implementation**

```javascript
// pastebin-service.js
// A production-oriented Paste Bin service using Express, PostgreSQL, Redis, and S3.

const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { S3Client, PutObjectCommand, GetObjectCommand,
        HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const zstd = require('@mixmark-io/zstd');          // zstd compression library

// --- Configuration ---
// These values would come from environment variables in production.
const PORT = 3000;
const BASE_URL = 'https://paste.example.com';
const MAX_PASTE_SIZE = 10 * 1024 * 1024;            // 10 MB maximum paste size
const S3_BUCKET = 'paste-content';                   // S3 bucket for content storage
const BASE62_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PASTE_ID_LENGTH = 8;                           // 62^8 = ~218 trillion possibilities
const CACHE_TTL = 3600;                              // 1 hour default cache TTL in seconds
const CONTENT_CACHE_MAX_SIZE = 100 * 1024;           // Only cache content under 100 KB

// --- Initialize dependencies ---
// PostgreSQL connection pool for metadata storage.
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  database: 'pastebin',
  user: process.env.DB_USER || 'pastebin',
  password: process.env.DB_PASSWORD,
  max: 20,                                           // Maximum pool size; tune per instance
});

// Redis client for caching metadata and small content.
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  maxRetriesPerRequest: 3,
});

// S3 client for content storage.
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

const app = express();
app.use(express.json({ limit: '11mb' }));            // Accept bodies up to 11MB (content + JSON overhead)
app.use(express.text({ limit: '11mb', type: 'text/plain' }));

// --- Utility Functions ---

/**
 * Generates a cryptographically secure random base62 string.
 * Uses crypto.randomBytes for security, ensuring paste IDs are not predictable.
 * This prevents enumeration attacks on unlisted pastes.
 */
function generatePasteId(length = PASTE_ID_LENGTH) {
  const bytes = crypto.randomBytes(length);          // Secure random bytes
  let result = '';
  for (let i = 0; i < length; i++) {
    // Map each byte to a base62 character.
    // Using modulo introduces slight bias, but 256 % 62 = 8 is small enough
    // for paste IDs (not cryptographic keys).
    result += BASE62_CHARS[bytes[i] % BASE62_CHARS.length];
  }
  return result;
}

/**
 * Computes the SHA-256 hash of the content.
 * This hash serves as the S3 object key and enables deduplication:
 * identical content produces the same hash, so it is stored only once.
 */
function computeContentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Builds the S3 key path from a content hash.
 * Uses the first four characters as a two-level prefix to distribute
 * objects evenly across S3's internal partitions.
 * Example: hash "a3f2b1c4..." becomes "a3/f2/a3f2b1c4...zst"
 */
function buildS3Key(contentHash) {
  const prefix1 = contentHash.substring(0, 2);       // First two hex chars
  const prefix2 = contentHash.substring(2, 4);       // Next two hex chars
  return `${prefix1}/${prefix2}/${contentHash}.zst`;  // Nested prefix + full hash
}

/**
 * Simple in-memory rate limiter using a sliding window counter.
 * In production, this would be backed by Redis for distributed rate limiting.
 * See Topic 42 for a comprehensive rate limiter design.
 */
const rateLimitMap = new Map();                       // Map<key, { count, windowStart }>
const RATE_LIMIT_WINDOW = 60 * 1000;                 // 1-minute window
const RATE_LIMIT_MAX = 10;                           // 10 pastes per minute per key

function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW) {
    // New window: reset counter.
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;                                     // Allowed
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;                                    // Rate limit exceeded
  }
  entry.count++;
  return true;                                       // Allowed
}

// --- API Endpoints ---

/**
 * POST /api/pastes
 * Creates a new paste. Accepts JSON body with:
 *   - content (string, required): The paste text content
 *   - title (string, optional): A human-readable title
 *   - language (string, optional): Language for syntax highlighting
 *   - visibility (string, optional): "public", "unlisted", or "private"
 *   - expiresIn (number, optional): Seconds until expiration
 */
app.post('/api/pastes', async (req, res) => {
  try {
    const { content, title, language, visibility, expiresIn } = req.body;

    // --- Input validation ---
    // Content is required and must not exceed the size limit.
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required and must be a string' });
    }
    const contentBuffer = Buffer.from(content, 'utf-8');
    if (contentBuffer.length > MAX_PASTE_SIZE) {
      return res.status(413).json({
        error: `Content exceeds maximum size of ${MAX_PASTE_SIZE / (1024 * 1024)} MB`
      });
    }

    // --- Rate limiting ---
    // Use the user ID if authenticated, otherwise use the client IP address.
    const rateLimitKey = req.headers['x-user-id'] || req.ip;
    if (!checkRateLimit(rateLimitKey)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    }

    // --- Normalize optional fields ---
    const safeTitle = title ? title.substring(0, 255) : null;        // Truncate long titles
    const safeLang = language || 'text';                              // Default: plain text
    const safeVisibility = ['public', 'unlisted', 'private'].includes(visibility)
      ? visibility
      : 'unlisted';                                                   // Default: unlisted

    // --- Generate paste ID ---
    // Cryptographically random to prevent enumeration of unlisted pastes.
    const pasteId = generatePasteId();

    // --- Compute content hash for deduplication ---
    const contentHash = computeContentHash(content);
    const sizeBytes = contentBuffer.length;

    // --- Upload content to S3 (deduplicated) ---
    const s3Key = buildS3Key(contentHash);

    // Check if this content already exists in S3 (deduplication check).
    // HeadObject is cheaper than GetObject -- it returns metadata without the body.
    let contentExists = false;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
      contentExists = true;                           // Content already stored; skip upload
    } catch (err) {
      if (err.name !== 'NotFound') {
        throw err;                                    // Unexpected error; propagate
      }
      // NotFound means we need to upload. This is the expected path for new content.
    }

    if (!contentExists) {
      // Compress the content using zstd before uploading.
      // Level 3 offers a good balance of speed and compression ratio.
      const compressed = await zstd.compress(contentBuffer, 3);

      // Upload compressed content to S3.
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: compressed,
        ContentType: 'application/zstd',
        Metadata: {
          'raw-size': String(sizeBytes),              // Store original size for decompression
          'compression': 'zstd',                      // Record algorithm for future compatibility
        },
      }));
    }

    // --- Compute expiration timestamp ---
    let expiresAt = null;
    if (expiresIn && Number.isFinite(expiresIn) && expiresIn > 0) {
      // expiresIn is in seconds; compute the absolute expiration time.
      expiresAt = new Date(Date.now() + expiresIn * 1000);
    }

    // --- Write metadata to PostgreSQL ---
    // This INSERT happens AFTER the S3 upload to avoid broken references.
    // If S3 upload succeeded but this INSERT fails, we have orphaned content
    // in S3 (benign; cleaned up by the orphan-detection job).
    const insertQuery = `
      INSERT INTO pastes (paste_id, user_id, title, language, visibility,
                          created_at, expires_at, content_hash, size_bytes, is_deleted)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, FALSE)
    `;
    const userId = req.headers['x-user-id'] || null;  // NULL for anonymous pastes
    await db.query(insertQuery, [
      pasteId, userId, safeTitle, safeLang, safeVisibility,
      expiresAt, contentHash, sizeBytes
    ]);

    // --- Return the paste URL ---
    return res.status(201).json({
      pasteId,
      url: `${BASE_URL}/${pasteId}`,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });
  } catch (err) {
    console.error('Error creating paste:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/pastes/:id
 * Retrieves a paste by its unique ID.
 * Checks cache first, then falls back to database + S3.
 * Returns 404 if not found, 410 if expired/deleted, 403 if private and unauthorized.
 */
app.get('/api/pastes/:id', async (req, res) => {
  try {
    const pasteId = req.params.id;

    // --- Step 1: Check Redis cache for metadata ---
    const cacheKey = `paste:${pasteId}`;
    let metadata = null;
    const cached = await redis.get(cacheKey);

    if (cached) {
      // Cache hit: parse the JSON metadata from Redis.
      metadata = JSON.parse(cached);
    } else {
      // Cache miss: query the database.
      const result = await db.query(
        'SELECT * FROM pastes WHERE paste_id = $1',
        [pasteId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Paste not found' });
      }

      metadata = result.rows[0];

      // Store metadata in Redis for subsequent requests.
      // TTL is the sooner of CACHE_TTL or time until expiration.
      let ttl = CACHE_TTL;
      if (metadata.expires_at) {
        const secondsUntilExpiry = Math.floor(
          (new Date(metadata.expires_at).getTime() - Date.now()) / 1000
        );
        ttl = Math.min(ttl, Math.max(secondsUntilExpiry, 1)); // At least 1 second
      }
      await redis.setex(cacheKey, ttl, JSON.stringify(metadata));
    }

    // --- Step 2: Check deletion and expiration ---
    if (metadata.is_deleted) {
      return res.status(410).json({ error: 'This paste has been deleted' });
    }
    if (metadata.expires_at && new Date(metadata.expires_at) < new Date()) {
      // Paste has expired. Return 410 and let the background worker handle cleanup.
      return res.status(410).json({ error: 'This paste has expired' });
    }

    // --- Step 3: Check visibility permissions ---
    if (metadata.visibility === 'private') {
      const requestingUserId = req.headers['x-user-id'];
      if (requestingUserId !== metadata.user_id) {
        return res.status(403).json({ error: 'Access denied: this paste is private' });
      }
    }

    // --- Step 4: Retrieve content ---
    // Check Redis content cache first (only for small pastes).
    const contentCacheKey = `content:${metadata.content_hash}`;
    let content = null;

    if (metadata.size_bytes < CONTENT_CACHE_MAX_SIZE) {
      const cachedContent = await redis.get(contentCacheKey);
      if (cachedContent) {
        content = cachedContent;                      // Content cache hit
      }
    }

    if (!content) {
      // Fetch from S3 and decompress.
      const s3Key = buildS3Key(metadata.content_hash);
      const s3Response = await s3.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      }));

      // Read the S3 response stream into a buffer.
      const chunks = [];
      for await (const chunk of s3Response.Body) {
        chunks.push(chunk);
      }
      const compressedBuffer = Buffer.concat(chunks);

      // Decompress the content.
      const decompressed = await zstd.decompress(compressedBuffer);
      content = decompressed.toString('utf-8');

      // Cache small content in Redis for subsequent requests.
      if (metadata.size_bytes < CONTENT_CACHE_MAX_SIZE) {
        await redis.setex(contentCacheKey, CACHE_TTL, content);
      }
    }

    // --- Step 5: Return the paste ---
    return res.status(200).json({
      pasteId: metadata.paste_id,
      title: metadata.title,
      language: metadata.language,
      visibility: metadata.visibility,
      createdAt: metadata.created_at,
      expiresAt: metadata.expires_at,
      sizeBytes: metadata.size_bytes,
      content,
    });
  } catch (err) {
    console.error('Error retrieving paste:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/pastes/:id
 * Soft-deletes a paste. Only the paste owner can delete.
 * Content is cleaned up asynchronously by the background worker.
 */
app.delete('/api/pastes/:id', async (req, res) => {
  try {
    const pasteId = req.params.id;
    const requestingUserId = req.headers['x-user-id'];

    // --- Fetch metadata to verify ownership ---
    const result = await db.query(
      'SELECT * FROM pastes WHERE paste_id = $1',
      [pasteId]
    );

    if (result.rows.length === 0 || result.rows[0].is_deleted) {
      return res.status(404).json({ error: 'Paste not found' });
    }

    const metadata = result.rows[0];

    // --- Authorization: only the owner can delete ---
    if (!requestingUserId || requestingUserId !== metadata.user_id) {
      return res.status(403).json({ error: 'Only the paste owner can delete this paste' });
    }

    // --- Soft-delete: set is_deleted = TRUE ---
    // We do NOT hard-delete the row because:
    // 1. We need it for reference counting (deduplication cleanup).
    // 2. It provides an audit trail.
    // 3. It can be undeleted if the deletion was accidental.
    await db.query(
      'UPDATE pastes SET is_deleted = TRUE WHERE paste_id = $1',
      [pasteId]
    );

    // --- Invalidate caches ---
    await redis.del(`paste:${pasteId}`);
    // Note: CDN purge would be called here in production.
    // cdn.purge(`${BASE_URL}/${pasteId}`);

    // --- Schedule content cleanup ---
    // In production, this would enqueue a message to a job queue (SQS, RabbitMQ, etc.).
    // The content cleanup worker processes these messages asynchronously.
    // For this example, we call the cleanup function directly.
    setImmediate(() => cleanupContent(metadata.content_hash));

    return res.status(200).json({ success: true, message: 'Paste deleted' });
  } catch (err) {
    console.error('Error deleting paste:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Background Workers ---

/**
 * Content cleanup: checks if any other active pastes reference the same content hash.
 * If no references remain, deletes the S3 object to reclaim storage.
 * This function handles the deduplication-aware deletion logic.
 */
async function cleanupContent(contentHash) {
  try {
    // Count non-deleted pastes that reference this content hash.
    const result = await db.query(
      'SELECT COUNT(*)::int AS ref_count FROM pastes WHERE content_hash = $1 AND is_deleted = FALSE',
      [contentHash]
    );

    const refCount = result.rows[0].ref_count;

    if (refCount === 0) {
      // No active references remain. Safe to delete from S3.
      const s3Key = buildS3Key(contentHash);
      await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
      // Also remove from content cache.
      await redis.del(`content:${contentHash}`);
      console.log(`Deleted orphaned content: ${contentHash}`);
    } else {
      console.log(`Content ${contentHash} still referenced by ${refCount} active paste(s). Skipping S3 delete.`);
    }
  } catch (err) {
    console.error(`Error during content cleanup for ${contentHash}:`, err);
    // Non-fatal: orphaned content wastes storage but does not cause functional errors.
    // The orphan-detection job will catch it eventually.
  }
}

/**
 * Expiration worker: runs periodically to find and soft-delete expired pastes.
 * Processes in batches to avoid overwhelming the database.
 * In production, this would be a separate process or a scheduled Lambda function.
 */
async function runExpirationWorker() {
  try {
    // Find expired, non-deleted pastes in batches of 500.
    const result = await db.query(
      `SELECT paste_id, content_hash FROM pastes
       WHERE expires_at < NOW() AND is_deleted = FALSE
       ORDER BY expires_at ASC
       LIMIT 500`
    );

    if (result.rows.length === 0) {
      return;                                         // No expired pastes to process
    }

    console.log(`Expiration worker: processing ${result.rows.length} expired paste(s)`);

    for (const paste of result.rows) {
      // Soft-delete the metadata record.
      await db.query(
        'UPDATE pastes SET is_deleted = TRUE WHERE paste_id = $1',
        [paste.paste_id]
      );

      // Invalidate the metadata cache.
      await redis.del(`paste:${paste.paste_id}`);

      // Schedule content cleanup.
      await cleanupContent(paste.content_hash);
    }

    console.log(`Expiration worker: completed processing ${result.rows.length} paste(s)`);
  } catch (err) {
    console.error('Expiration worker error:', err);
    // Non-fatal: worker will retry on the next cycle.
  }
}

// Run the expiration worker every 60 seconds.
// In production, use a proper job scheduler (cron, Bull, Agenda, etc.)
// to ensure exactly-once execution across multiple instances.
setInterval(runExpirationWorker, 60 * 1000);

// --- Database Schema Initialization ---
/**
 * Creates the pastes table and indexes if they do not exist.
 * In production, use a migration tool (Knex, Flyway, Liquibase).
 */
async function initializeDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS pastes (
      paste_id      VARCHAR(12)  PRIMARY KEY,
      user_id       VARCHAR(36),
      title         VARCHAR(255),
      language      VARCHAR(50)  DEFAULT 'text',
      visibility    VARCHAR(10)  DEFAULT 'unlisted'
                    CHECK (visibility IN ('public', 'unlisted', 'private')),
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ,
      content_hash  CHAR(64)     NOT NULL,
      size_bytes    INT          NOT NULL,
      is_deleted    BOOLEAN      DEFAULT FALSE
    );

    -- Index for expiration cleanup worker.
    CREATE INDEX IF NOT EXISTS idx_pastes_expiration
      ON pastes (expires_at, is_deleted)
      WHERE expires_at IS NOT NULL AND is_deleted = FALSE;

    -- Index for user's paste listing.
    CREATE INDEX IF NOT EXISTS idx_pastes_user
      ON pastes (user_id, created_at DESC)
      WHERE user_id IS NOT NULL;

    -- Index for deduplication reference counting.
    CREATE INDEX IF NOT EXISTS idx_pastes_content_hash
      ON pastes (content_hash)
      WHERE is_deleted = FALSE;

    -- Index for public paste discovery.
    CREATE INDEX IF NOT EXISTS idx_pastes_public_recent
      ON pastes (created_at DESC)
      WHERE visibility = 'public' AND is_deleted = FALSE;
  `);
  console.log('Database schema initialized');
}

// --- Server Startup ---
async function start() {
  await initializeDatabase();                         // Ensure schema exists
  app.listen(PORT, () => {
    console.log(`PasteBin service running on port ${PORT}`);
    console.log(`Base URL: ${BASE_URL}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

**Line-by-Line Explanation of Key Sections**

The `generatePasteId` function uses `crypto.randomBytes` rather than `Math.random` because paste IDs for unlisted pastes serve as a de facto access control mechanism. If IDs were predictable (sequential counters or weak random numbers), an attacker could enumerate unlisted pastes. Cryptographic randomness makes enumeration computationally infeasible. The modulo operation introduces a slight bias (256 is not evenly divisible by 62), but for paste IDs this bias is negligible. For true cryptographic key generation, rejection sampling would be needed.

The `computeContentHash` function uses SHA-256 because it provides collision resistance sufficient for our deduplication use case. The probability of two different paste contents producing the same SHA-256 hash is approximately 2^(-128), which is effectively zero. MD5 or SHA-1 would be faster but have known collision vulnerabilities, making them unsuitable if the system might be targeted by deliberate collision attacks.

The `buildS3Key` function constructs a two-level prefix directory structure from the hash. S3 partitions data internally by key prefix, and concentrating millions of objects under a flat key space can lead to throttling. The prefix structure ensures even distribution. This pattern is standard practice for high-volume S3 usage, although recent S3 improvements have reduced the necessity.

In the `POST /api/pastes` handler, note the deliberate ordering: S3 upload happens before the database write. This means that if the database write fails, we have orphaned content in S3 (wasted storage, cleaned up periodically) rather than a metadata record pointing to missing content (broken paste, visible user error). This ordering is a conscious trade-off that prioritizes user experience over storage efficiency.

The `GET /api/pastes/:id` handler implements a two-level cache strategy. It checks Redis for metadata first (fast, sub-millisecond), then falls back to the database on cache miss. For content, it checks Redis only for small pastes (under 100 KB) to avoid consuming expensive Redis memory with large content. Large content is fetched directly from S3, which is optimized for this access pattern. The CDN (not shown in this code, as it operates at the infrastructure level) provides an additional caching layer in front of the entire API.

The expiration worker uses a `LIMIT 500` clause to process expired pastes in batches. Without this limit, a backlog of millions of expired pastes could cause the query to consume excessive database resources. Batching with periodic execution ensures steady, predictable load. The `ORDER BY expires_at ASC` ensures that the oldest expired pastes are cleaned up first, which is the intuitive and fair ordering.

The `cleanupContent` function performs reference counting before deleting S3 objects. This is the critical deduplication-aware deletion logic: if other active pastes still reference the same content hash, the S3 object must be preserved. The function is deliberately tolerant of errors -- a failed cleanup is logged and retried on the next cycle, because orphaned content is a cost issue, not a correctness issue.

---

### Section 12 --- Connection to Next Topic

The Paste Bin design taught you how to build a service that stores and serves user-generated content at scale. You wrestled with content storage strategies, caching layers, expiration mechanisms, and abuse prevention. One theme ran through several of these sections: the need to protect the system from excessive or malicious usage. Rate limiting appeared as a footnote in the paste creation flow -- a necessary check that prevents any single actor from overwhelming the service. But rate limiting itself is a rich design problem that deserves its own deep treatment.

In Topic 42, Design a Rate Limiter, you will zoom into this protective mechanism and treat it as a first-class system. You will explore the algorithms behind rate limiting (token bucket, leaky bucket, sliding window counter, sliding window log), the trade-offs between them, and how to implement distributed rate limiting across a fleet of stateless API servers. Where the Paste Bin design asked "how do I store and serve content?", the Rate Limiter design asks "how do I control who can access the service and how often?" These two questions are complementary: every production API needs both content serving and traffic control. The rate limiter you design in Topic 42 is exactly the component that would sit in front of the Paste Bin API to enforce the rate limits we mentioned in Section 7.

The transition from Paste Bin to Rate Limiter also represents a shift from data-plane design (handling user content) to control-plane design (managing system behavior). The data plane processes requests: accepting pastes, storing them, serving them. The control plane governs how the data plane operates: how many requests are allowed, from whom, and at what rate. Understanding both planes -- and the boundary between them -- is essential for designing robust, production-grade systems. The Rate Limiter is your first focused study of control-plane design, and the patterns you learn there (counters, windowing, distributed state) will reappear in load balancing, circuit breaking, and admission control throughout the rest of this curriculum.
---

<!--
Topic: 42
Title: Design a Rate Limiter
Section: 09 — Real-World Designs Part 1
Track: 80/20 Core
Difficulty: mid
Interview Weight: very-high
Prerequisites: Topics 1-3 (Fundamentals), Topic 10 (Caching), Topic 15 (Load Balancing), Topic 18 (API Design)
Next Topic: Topic 43 — Design a Key-Value Store
Estimated Reading Time: 45-55 minutes
-->

## Topic 42: Design a Rate Limiter

---

### Section 1 — Why This Design?

In January 2018, GitHub introduced stricter rate limits on its REST API: authenticated requests were capped at 5,000 per hour, while unauthenticated ones got just 60. The reason was straightforward. A small percentage of users — automated scripts, misconfigured CI pipelines, and occasionally malicious actors — were generating disproportionate load on GitHub's infrastructure. Without throttling, a single runaway bot could degrade the experience for millions of developers relying on the platform. Rate limiting was not a nice-to-have; it was an existential requirement for keeping the service alive.

GitHub's story is far from unique. Twitter (now X) has long enforced rate limits across its API surface — 900 requests per 15-minute window for most read endpoints, 300 for writes. Stripe, which processes billions of dollars in payments, uses rate limiting not just for protection but as a core part of its API contract: every Stripe response includes `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers so developers can build self-throttling clients. Cloudflare turned rate limiting into an entire product, offering configurable rules that protect over 25 million internet properties from abuse, DDoS amplification, and credential stuffing attacks. In each of these cases, rate limiting is not bolted on as an afterthought — it is foundational infrastructure that determines the reliability and fairness of the entire system.

This is why "Design a Rate Limiter" is one of the most frequently asked system design interview questions at companies like Google, Amazon, Meta, and Stripe. It sits at the intersection of several critical concepts: distributed systems coordination, algorithmic trade-offs, low-latency data stores, and API design. It is deceptively simple on the surface — count requests and reject excess ones — but the moment you start thinking about distributed deployments, clock synchronization, race conditions, and fairness across millions of users, the problem reveals surprising depth. A candidate who can navigate these trade-offs with clarity demonstrates exactly the kind of systems thinking that senior engineering roles demand.

The rate limiter also serves as a gateway to understanding broader system protection patterns: circuit breakers, backpressure, load shedding, and graceful degradation. Mastering this design gives you a mental framework that applies far beyond the specific component. Every production system you will ever build or operate will need some form of rate limiting, whether it is explicit API throttling, database connection pooling, or queue depth management.

---

### Section 2 — Requirements Gathering

Before diving into architecture, a strong interview candidate starts by clarifying the scope. Rate limiters can range from a simple in-process counter to a globally distributed throttling service. The requirements you gather will shape every subsequent decision.

**Functional Requirements**

The core function is straightforward: given a stream of incoming requests, the system must decide whether to allow or reject each one based on configurable rules. Specifically, the rate limiter must support limiting requests by multiple identifiers — user ID, IP address, API key, or any combination thereof. When a request exceeds the configured limit, the system must return an HTTP 429 (Too Many Requests) response with appropriate headers indicating when the client can retry. The system must support different rate limit tiers: a free-tier user might get 100 requests per minute, while an enterprise customer gets 10,000. Rules should be configurable without redeployment — an operations team needs to adjust limits in real-time during an incident or a product launch. The system should also support rate limiting at different granularities: per-endpoint (e.g., the login endpoint has a tighter limit than a read-only GET), per-service, or globally.

**Non-Functional Requirements**

Latency is the paramount non-functional requirement. The rate limiter sits in the critical path of every single request. If it adds 50ms of overhead, it has effectively doubled the response time of many APIs. The target is less than 1ms of added latency for the rate-check operation. Accuracy matters but is nuanced — in a distributed system, perfect accuracy (never allowing even one extra request) may be impractical, and slight over-allowance is generally preferable to false rejections of legitimate traffic. The system must be distributed, because modern services run across multiple data centers and dozens of application servers. It must be highly available — if the rate limiter goes down, we need a clear policy on whether to allow all traffic (fail-open) or block all traffic (fail-closed). Finally, memory efficiency is important because we may be tracking rate state for millions of concurrent users.

**Back-of-Envelope Estimation**

Let us estimate the scale for a mid-to-large API platform:

```
Users:                  1,000,000 active users
Avg requests per user:  500 requests/hour
Total requests:         500,000,000 requests/hour
                      = ~139,000 requests/second (QPS)
                      = ~140K QPS average

Peak traffic (3x avg):  ~420K QPS

Rate limit window:      1 minute (most common)
Unique keys to track:   1,000,000 users x 10 endpoints = 10,000,000 keys

Memory per key (token bucket):
  - Key (user:endpoint):  ~50 bytes
  - Token count:          8 bytes (int64)
  - Last refill timestamp: 8 bytes
  - Overhead:             ~14 bytes
  - Total per key:        ~80 bytes

Total memory for all keys:
  10,000,000 keys x 80 bytes = 800 MB

Memory per key (sliding window log):
  - Key:                  ~50 bytes
  - Sorted set entries:   500 req/hr x 8 bytes each = 4,000 bytes
  - Total per key:        ~4,050 bytes

Total memory (sliding window log):
  10,000,000 keys x 4,050 bytes = ~40.5 GB  (much more expensive!)

Redis single node throughput: ~100K-200K ops/sec
With our 420K QPS peak, we need at minimum 3-5 Redis nodes
  (each rate check = 1-2 Redis operations)
```

These numbers immediately tell us several things. Token bucket or fixed/sliding window counters are viable in a single Redis cluster. Sliding window log, which stores every timestamp, is memory-prohibitive at scale. And we will need a small Redis cluster, not a single node, to handle peak throughput.

---

### Section 3 — High-Level Architecture

The first architectural decision is where to place the rate limiter in the request path. There are four options, each with distinct trade-offs.

**Client-side rate limiting** means the client self-throttles before sending requests. This is cooperative and unreliable — a malicious client will simply ignore the limits. It is useful as an optimization (preventing unnecessary network calls) but cannot be the primary enforcement mechanism.

**Server-side rate limiting** embeds the rate-check logic directly in the application server. This is simple for monoliths but becomes problematic when you have dozens of microservices, each needing its own rate limiting logic. It also means the rate limiter only kicks in after the request has already consumed network and TLS overhead.

**Middleware / API Gateway rate limiting** is the most common production pattern. The rate limiter runs as a middleware layer (e.g., in NGINX, Envoy, or a custom API gateway) that intercepts requests before they reach the application. This centralizes the logic, keeps application code clean, and allows the rate check to reject requests before expensive business logic executes. AWS API Gateway, Kong, and Cloudflare all implement rate limiting at this layer.

**Sidecar / service mesh rate limiting** deploys rate limiting as a sidecar proxy (e.g., in Istio/Envoy). This is the cloud-native approach that works well in Kubernetes environments, providing rate limiting without modifying application code.

For our design, we will use the **middleware / API gateway** approach as the primary architecture, with the rate limiter implemented as a middleware component that can be deployed in front of any service.

Here is the high-level architecture:

```
                         +------------------+
    Client Request ----->| Load Balancer    |
                         +--------+---------+
                                  |
                         +--------v---------+
                         | API Gateway /    |
                         | Rate Limiter     |----+
                         | Middleware       |    |
                         +--------+---------+    |
                                  |              |
                          Allow?  |        +-----v------+
                          Yes     |        | Redis      |
                                  |        | (Counters) |
                         +--------v---------+  +-----^------+
                         | Application      |        |
                         | Servers          |        |
                         | (Cluster)        |        |
                         +------------------+        |
                                                     |
                         +------------------+        |
                         | Rules Config     |--------+
                         | Service / DB     |
                         +------------------+
```

The core components are:

1. **Rules Engine**: Reads rate limit configurations (which endpoints, which limits, which tiers) from a configuration store. Rules are cached locally with a short TTL so that updates propagate within seconds without requiring a config-store lookup on every request.

2. **Counter Storage (Redis)**: The beating heart of the rate limiter. Redis stores the current request count (or token count) for each user-endpoint combination. Redis is chosen because it provides sub-millisecond latency, atomic operations, built-in TTL for automatic key expiration, and well-understood clustering.

3. **Rate Limiter Middleware**: The decision-making layer. It extracts the client identifier from the request (user ID from auth token, IP from headers, API key from query params), constructs the rate limit key, queries Redis, and either forwards the request or returns a 429 response with appropriate headers.

4. **Response Enrichment**: Regardless of allow/deny, the middleware adds rate limit headers to every response so clients can implement self-throttling.

For a single-server deployment (useful for development or low-traffic services), the counter storage can be an in-memory hash map, eliminating the Redis dependency entirely. But for any production system serving more than one application instance, a shared external store like Redis is necessary to maintain a consistent view of request counts across all servers.

---

### Section 4 — Deep Dive: Rate Limiting Algorithms

The algorithm you choose for counting and enforcing limits is the single most consequential design decision. Each algorithm trades off accuracy, memory, burst handling, and implementation complexity in different ways. Let us examine five algorithms in detail.

**Algorithm 1: Token Bucket**

The token bucket is the most widely used rate limiting algorithm in production systems. Amazon uses it for AWS API throttling, and Stripe uses it for its payment API. The mental model is a bucket that holds tokens. Tokens are added to the bucket at a fixed rate (the refill rate). Each request consumes one token. If the bucket is empty, the request is rejected. The bucket has a maximum capacity, which determines the maximum burst size.

For example, with a capacity of 10 tokens and a refill rate of 1 token per second, a client can burst up to 10 requests instantly, then must slow down to 1 request per second. If the client is idle for 10 seconds, the bucket refills to capacity, allowing another burst. This burst-friendly behavior is exactly what most API clients need — occasional spikes are fine, sustained overuse is not.

The implementation requires storing just two values per key: the current token count and the timestamp of the last refill. On each request, you calculate how many tokens should have been added since the last refill, add them (capped at the bucket capacity), then try to consume one token. This makes it extremely memory-efficient.

```
PSEUDOCODE: Token Bucket Algorithm

function allowRequest(key, capacity, refillRate):
    bucket = store.get(key)

    if bucket is null:
        // First request — create a full bucket
        bucket = { tokens: capacity - 1, lastRefill: now() }
        store.set(key, bucket, TTL = capacity / refillRate * 2)
        return ALLOW

    // Calculate tokens to add since last refill
    elapsed = now() - bucket.lastRefill
    tokensToAdd = elapsed * refillRate
    bucket.tokens = min(capacity, bucket.tokens + tokensToAdd)
    bucket.lastRefill = now()

    if bucket.tokens >= 1:
        bucket.tokens = bucket.tokens - 1
        store.set(key, bucket)
        return ALLOW
    else:
        return REJECT
```

Pros: memory-efficient (two values per key), allows controlled bursts, simple to understand, widely battle-tested. Cons: two parameters to tune (capacity and refill rate), which can be confusing for non-technical stakeholders who think in terms of "X requests per Y minutes."

**Algorithm 2: Leaky Bucket**

The leaky bucket is conceptually a queue with a fixed processing rate. Requests enter the queue (the bucket) and are processed (leaked out) at a constant rate. If the queue is full, new requests are dropped. Unlike the token bucket, which allows bursts, the leaky bucket enforces a perfectly smooth outflow rate.

This is ideal when you need to protect a downstream service that cannot handle any burst at all — for example, a legacy database that becomes unstable under bursty load. Shopify uses leaky bucket for its API rate limiting to provide predictable throughput to merchants.

```
PSEUDOCODE: Leaky Bucket Algorithm

function allowRequest(key, bucketSize, leakRate):
    bucket = store.get(key)

    if bucket is null:
        bucket = { queueSize: 1, lastLeak: now() }
        store.set(key, bucket)
        return ALLOW

    // Drain requests that have leaked since last check
    elapsed = now() - bucket.lastLeak
    leaked = elapsed * leakRate
    bucket.queueSize = max(0, bucket.queueSize - leaked)
    bucket.lastLeak = now()

    if bucket.queueSize < bucketSize:
        bucket.queueSize = bucket.queueSize + 1
        store.set(key, bucket)
        return ALLOW
    else:
        return REJECT
```

Pros: smooth, predictable output rate; simple to implement. Cons: a burst of traffic fills the queue and forces subsequent requests to wait even if the long-term rate is well within limits; recent requests get penalized by older ones.

**Algorithm 3: Fixed Window Counter**

This is the simplest approach. Divide time into fixed windows (e.g., each minute: 12:00-12:01, 12:01-12:02) and maintain a counter for each window. Increment on each request; reject when the counter exceeds the limit.

```
PSEUDOCODE: Fixed Window Counter

function allowRequest(key, limit, windowSize):
    windowKey = key + ":" + floor(now() / windowSize)
    count = store.increment(windowKey)

    if count == 1:
        store.setTTL(windowKey, windowSize)

    if count <= limit:
        return ALLOW
    else:
        return REJECT
```

The implementation is elegant — a single Redis INCR command with a TTL handles the entire logic. But the fixed window has a well-known boundary problem. If a user sends 100 requests at 12:00:59 (end of one window) and 100 more at 12:01:01 (start of the next), they have effectively sent 200 requests in a 2-second span while never exceeding the 100-per-minute limit in either window. This can allow twice the intended rate at window boundaries.

Pros: extremely simple, single Redis operation, very low memory. Cons: the boundary problem can allow up to 2x the intended rate at window edges.

**Algorithm 4: Sliding Window Log**

To eliminate the boundary problem, the sliding window log stores the timestamp of every single request. To check the rate, you remove all timestamps older than the window size and count what remains. If the count exceeds the limit, the request is rejected.

```
PSEUDOCODE: Sliding Window Log

function allowRequest(key, limit, windowSize):
    windowStart = now() - windowSize

    // Remove expired entries
    store.removeRange(key, 0, windowStart)

    // Count entries in current window
    count = store.count(key)

    if count < limit:
        store.add(key, now(), now())   // score=timestamp, value=timestamp
        return ALLOW
    else:
        return REJECT
```

In Redis, this maps naturally to a sorted set (ZSET), where the score is the request timestamp. ZREMRANGEBYSCORE removes expired entries, ZCARD counts current ones, and ZADD inserts a new one.

Pros: perfectly accurate, no boundary problem. Cons: memory usage is proportional to the request rate (storing every timestamp). As we calculated in Section 2, this can balloon to 40+ GB for a large-scale service. This algorithm is viable only for low-volume, high-precision use cases like login attempt limiting.

**Algorithm 5: Sliding Window Counter (Hybrid)**

The sliding window counter is the clever hybrid that combines the memory efficiency of fixed windows with the accuracy of sliding windows. It keeps counters for the current and previous fixed windows, then estimates the count in the sliding window using a weighted average.

```
PSEUDOCODE: Sliding Window Counter

function allowRequest(key, limit, windowSize):
    currentWindow = floor(now() / windowSize)
    previousWindow = currentWindow - 1
    elapsedInCurrentWindow = (now() % windowSize) / windowSize

    currentCount = store.get(key + ":" + currentWindow) or 0
    previousCount = store.get(key + ":" + previousWindow) or 0

    // Weighted estimate of requests in the sliding window
    estimatedCount = previousCount * (1 - elapsedInCurrentWindow) + currentCount

    if estimatedCount < limit:
        store.increment(key + ":" + currentWindow)
        return ALLOW
    else:
        return REJECT
```

For example, if the window is 1 minute, we are 30 seconds into the current window, the previous window had 80 requests, and the current window has 30 requests so far, the estimated count is: 80 * 0.5 + 30 = 70. This is an approximation, but Cloudflare's engineering team has shown that the error rate is extremely low (less than 0.003% in their production measurements) because request distributions tend to be relatively uniform within a window.

Pros: memory-efficient (just two counters per key), very accurate in practice, no boundary spike. Cons: approximate (not exact), slightly more complex than fixed window.

**Algorithm Comparison Table**

```
+----------------------+--------+-----------+-------+---------+------------+
| Algorithm            | Memory | Accuracy  | Burst | Latency | Complexity |
+----------------------+--------+-----------+-------+---------+------------+
| Token Bucket         | Low    | Good      | Yes   | O(1)    | Low        |
| Leaky Bucket         | Low    | Good      | No    | O(1)    | Low        |
| Fixed Window Counter | Low    | Moderate  | Edge* | O(1)    | Very Low   |
| Sliding Window Log   | High   | Perfect   | No    | O(N)    | Medium     |
| Sliding Window Ctr   | Low    | Very Good | No    | O(1)    | Medium     |
+----------------------+--------+-----------+-------+---------+------------+

* "Edge" means bursts can occur at window boundaries (the 2x problem).
```

For most production systems, the **token bucket** or **sliding window counter** are the best choices. Token bucket is preferred when burst tolerance is desirable (most API rate limiting). Sliding window counter is preferred when you want smooth, predictable enforcement without bursts.

---

### Section 5 — Distributed Rate Limiting

Everything discussed so far works perfectly on a single server. But production systems run across multiple servers, often in multiple data centers. This is where rate limiting gets genuinely hard.

**The Core Problem**

Imagine you have 10 application servers behind a load balancer, each running a rate limiter middleware. A user with a 100 requests/minute limit sends 100 requests. If the load balancer distributes them roughly evenly, each server sees about 10 requests — well under the limit on any individual server. But the user has consumed their entire allocation globally. Without coordination, the user could send 1,000 requests per minute (100 per server) and never be throttled.

**Approach 1: Centralized Counter Store (Redis)**

The most common and recommended solution is to use a centralized Redis instance (or cluster) that all application servers share. Every rate check goes to the same Redis, so all servers see a consistent global count. This is what most companies (Stripe, GitHub, Lyft) use in production.

The challenge is that this introduces a network round-trip on every request. With Redis sub-millisecond latency on a local network, this typically adds 0.2-0.5ms of overhead — acceptable for the vast majority of use cases. The centralized Redis also becomes a potential single point of failure, which we address with Redis Sentinel or Redis Cluster for high availability.

**Approach 2: Race Conditions and Lua Scripting**

Even with centralized Redis, race conditions are a real problem. Consider two requests arriving simultaneously at different servers for the same user. Both read the counter as 99 (limit is 100), both decide to allow, both increment to 100. But two requests were allowed when only one should have been. This is the classic check-then-act race condition.

The solution is to make the check-and-increment atomic. Redis provides two mechanisms for this. The first is the INCR command itself — since INCR is atomic and returns the new value, you can increment first and check after. If the new value exceeds the limit, reject the request (the counter is now over-limit, but that is fine because it will expire with the TTL).

For more complex algorithms like the sliding window counter, atomicity requires a Lua script. Redis executes Lua scripts atomically — no other command can interleave during execution.

```
-- Redis Lua script for atomic sliding window counter
local currentKey = KEYS[1]
local previousKey = KEYS[2]
local limit = tonumber(ARGV[1])
local windowSize = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local currentWindow = math.floor(now / windowSize)
local elapsedRatio = (now % windowSize) / windowSize

local previousCount = tonumber(redis.call('GET', previousKey) or "0")
local currentCount = tonumber(redis.call('GET', currentKey) or "0")

local estimatedCount = previousCount * (1 - elapsedRatio) + currentCount

if estimatedCount < limit then
    redis.call('INCR', currentKey)
    redis.call('EXPIRE', currentKey, windowSize * 2)
    return 1  -- ALLOW
else
    return 0  -- REJECT
end
```

This entire script executes as a single atomic operation in Redis, eliminating race conditions entirely.

**Approach 3: Sticky Sessions**

An alternative to centralized counting is to use sticky sessions (session affinity) at the load balancer. If all requests from a given user always go to the same application server, that server can maintain an in-memory rate counter without any external coordination. This eliminates the Redis dependency entirely.

However, sticky sessions have significant drawbacks. If a server goes down, its rate limit state is lost — users previously tracked by that server will get a fresh allowance on whichever server picks them up. Sticky sessions also cause uneven load distribution, which can lead to hotspots. And they do not work across multiple data centers.

**Approach 4: Eventual Consistency with Local Counters**

For ultra-high-throughput scenarios where even the Redis round-trip is too expensive, some systems use a hybrid approach. Each application server maintains local in-memory counters and periodically synchronizes with a central store (or with peer servers). Between syncs, the local rate limiter enforces a proportional share of the global limit. For example, if there are 10 servers and the limit is 1,000 requests/minute, each server locally enforces 100 requests/minute and syncs every few seconds.

This approach trades accuracy for performance. Between sync intervals, the system might allow slightly more or fewer requests than the intended limit. The sync interval determines the trade-off — shorter intervals mean more accuracy but more coordination overhead.

**Redis Cluster for High Availability**

A single Redis instance is a single point of failure. For production deployments, you should use Redis Cluster or Redis Sentinel. Redis Cluster partitions keys across multiple nodes (each key is assigned to a hash slot), providing both horizontal scaling and fault tolerance. If one node fails, its replica takes over. With three master nodes and three replicas, you can survive any single-node failure without data loss.

An important subtlety: when using Redis Cluster, ensure that keys that must be read together in a Lua script (like the current and previous window counters) hash to the same slot. Redis enforces this — Lua scripts can only access keys on the same node. Use hash tags (e.g., `{user123}:current` and `{user123}:previous`) to force co-location.

---

### Section 6 — Database and Storage Design

**Why Redis Over a Traditional Database**

The rate limiter must handle every single incoming request with minimal added latency. A traditional relational database like PostgreSQL, even with connection pooling and prepared statements, typically provides single-digit millisecond latency for simple queries. Redis, by contrast, operates in sub-millisecond territory (0.1-0.3ms per operation on a local network) because it keeps all data in memory, uses a single-threaded event loop that avoids lock contention, and speaks a binary protocol designed for minimal overhead. At 420K QPS peak, even a 5ms database query would require 2,100 concurrent database connections just to keep up — an impractical load for any relational database. Redis handles this with a single thread.

Some teams evaluate Memcached as an alternative to Redis. Memcached is slightly faster for simple key-value lookups, but it lacks the data structures (sorted sets, Lua scripting) needed for algorithms beyond simple fixed-window counting. Redis is the clear winner for rate limiting.

**Key Design Patterns**

The key structure in Redis should encode all dimensions of the rate limit rule. A well-designed key pattern looks like:

```
rate_limit:{user_id}:{endpoint}:{window}

Examples:
  rate_limit:user_42:/api/v1/messages:1706400000
  rate_limit:user_42:/api/v1/search:1706400000
  rate_limit:ip_192.168.1.1:/api/v1/login:1706400060
  rate_limit:apikey_sk_live_abc:/api/v1/charges:1706400000
```

The window component is the Unix timestamp of the window start (floored to the window size). This ensures each window gets a unique key, and old keys naturally expire via TTL.

For multi-dimensional rate limiting (e.g., limit per user AND per IP), use separate keys for each dimension and check all of them:

```
rate_limit:user:user_42:global:1706400000       -> 100/min limit
rate_limit:user:user_42:/api/search:1706400000  -> 20/min limit
rate_limit:ip:192.168.1.1:global:1706400000     -> 500/min limit
```

A request is rejected if ANY of its applicable limits is exceeded.

**TTL-Based Cleanup**

One of the elegant aspects of using Redis is automatic key expiration. Every rate limit key is set with a TTL equal to the window size (or 2x the window size for sliding window counters that need the previous window). When the window expires, Redis automatically deletes the key, freeing memory. There is no need for background cleanup jobs, garbage collection cron tasks, or manual purging. This is a major operational advantage.

Set the TTL slightly longer than the window to handle clock skew:

```
TTL = windowSize + 10 seconds (buffer for clock drift)
```

**Sliding Window Implementation with Sorted Sets**

For the sliding window log algorithm (when precision is required for a small number of keys), Redis sorted sets provide an ideal data structure:

```
Key:    rate_limit:user_42:/api/login
Type:   ZSET (sorted set)
Members: Each member is a unique request ID or timestamp
Scores:  Unix timestamp in milliseconds

Operations per request:
  1. ZREMRANGEBYSCORE key 0 (now - windowSize)    -- remove expired
  2. ZCARD key                                      -- count current
  3. ZADD key now requestId                         -- add new (if allowed)
  4. EXPIRE key windowSize                          -- refresh TTL
```

Wrapping these four operations in a Lua script ensures atomicity. The sorted set automatically maintains entries ordered by timestamp, making range deletions efficient (O(log N + M) where M is the number of removed elements).

**Memory Optimization**

For large-scale deployments, consider these memory optimization strategies. First, use short key names — `rl:u42:msg:17064` instead of `rate_limit:user_42:/api/v1/messages:1706400000`. At millions of keys, this saves significant memory. Second, use Redis hash compression: if a hash has fewer than 128 fields with values under 64 bytes, Redis stores it as a ziplist, which is substantially more memory-efficient. You can group multiple rate limit counters for the same user into a single hash. Third, if using the sliding window log, cap the maximum number of entries in the sorted set to the rate limit itself — there is no need to store more timestamps than the limit allows.

---

### Section 7 — Scaling and Reliability

**Fail-Open vs Fail-Closed**

The most critical reliability question is: what happens when the rate limiter's backing store (Redis) becomes unavailable? There are two philosophies.

**Fail-open** means if the rate limiter cannot check the limit (Redis is down, network partition, timeout), it allows the request through. The rationale is that blocking legitimate users is worse than temporarily allowing potential abuse. Most user-facing API services choose this approach. If Redis is down for 30 seconds, some users might exceed their limits, but the service stays operational. You can mitigate the risk by falling back to local in-memory rate limiting during the outage, which provides coarse-grained protection.

**Fail-closed** means if the rate limiter cannot verify the request is within limits, it rejects the request. This is appropriate for security-critical endpoints — login attempts, payment processing, or any endpoint where abuse has severe consequences. The trade-off is that a Redis outage becomes a service outage for affected endpoints.

Most production systems use a nuanced hybrid: fail-open for general API rate limiting, fail-closed for security-sensitive endpoints like authentication and password reset.

**Redis Cluster Partitioning**

When using Redis Cluster, a network partition can split the cluster into two groups. During the partition, writes might be accepted on both sides, leading to inconsistent counts. After the partition heals, Redis Cluster uses last-write-wins conflict resolution, which might lose some counter increments. For rate limiting, this is generally acceptable — a few extra requests slipping through during a rare partition event is a tolerable trade-off.

To minimize the window of inconsistency, configure the `cluster-node-timeout` to a low value (e.g., 5 seconds) so that partitioned nodes stop accepting writes quickly.

**Local Rate Limiting as Fallback**

A robust rate limiter has a layered defense strategy:

```
Layer 1: Distributed rate limiting via Redis (primary)
    |
    v  (Redis unavailable?)
Layer 2: Local in-memory rate limiting per server
    |
    v  (server overloaded?)
Layer 3: Connection-level throttling (NGINX/OS level)
```

The local fallback divides the global limit by the number of active servers. If the global limit is 1,000 requests/minute and there are 10 servers, each server locally enforces 100 requests/minute. This is imprecise (server counts change, load is not evenly distributed) but provides basic protection during a Redis outage.

**Rate Limiting the Rate Limiter**

This sounds circular but is a real concern. If every incoming request makes 2-3 Redis calls, and your system receives a traffic spike 10x above normal (say, during a DDoS), the rate limiter's Redis calls might themselves overwhelm Redis. Protect against this by using connection pooling with a maximum pool size, implementing a local circuit breaker that trips after consecutive Redis timeouts (falling back to local rate limiting), and rate-limiting the frequency of Lua script evaluations using client-side batching.

**Monitoring and Alerting**

A production rate limiter needs comprehensive observability. Key metrics to track include: the number of requests allowed vs rejected (broken down by rule, user tier, and endpoint), Redis latency percentiles (p50, p95, p99), Redis memory usage and key count, rate limit rule evaluation latency, and the number of clients currently at or near their limit. Set alerts on sudden spikes in rejection rate (might indicate a DDoS or a misconfigured client), Redis latency exceeding 1ms (degradation of the backing store), and rate limit rules that are never triggered (potentially misconfigured or too generous).

---

### Section 8 — Advanced Features

**Rate Limit Response Headers**

A well-designed rate limiter communicates its state to clients through standard HTTP headers. This is not optional — it is essential for building a good developer experience and enabling clients to self-throttle.

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 100              # Maximum requests allowed in window
X-RateLimit-Remaining: 67           # Requests remaining in current window
X-RateLimit-Reset: 1706400120       # Unix timestamp when the window resets

HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1706400120
Retry-After: 45                      # Seconds until the client should retry
Content-Type: application/json

{
  "error": "rate_limit_exceeded",
  "message": "Rate limit of 100 requests per minute exceeded.",
  "retry_after": 45
}
```

The `Retry-After` header is defined in RFC 7231 and tells the client exactly how many seconds to wait before retrying. Well-behaved clients (like official SDKs) use this to implement exponential backoff automatically. GitHub's Octokit library, for example, automatically sleeps for the `Retry-After` duration when it receives a 429 response.

Including these headers on every response (not just 429 responses) is important. A client seeing `X-RateLimit-Remaining: 5` can proactively slow down before hitting the wall, leading to a much smoother experience than waiting for a 429.

**Multi-Dimensional Rate Limiting**

Production rate limiters typically enforce multiple overlapping rules simultaneously. A single request might be subject to:

1. A global rate limit (10,000 requests/minute across all endpoints)
2. An endpoint-specific rate limit (100 requests/minute to /api/search)
3. A user-tier rate limit (free users: 60/min, paid: 600/min, enterprise: 6,000/min)
4. An IP-based rate limit (to catch abuse from shared accounts)
5. A geographic or origin-based rate limit

The rate limiter evaluates all applicable rules and applies the most restrictive one. This requires multiple Redis lookups per request, but since Redis operations take 0.1-0.3ms each, even five lookups add less than 2ms of latency. Using Redis pipelines (sending all commands at once and reading all responses) reduces this further by eliminating multiple round-trips.

```
Multi-dimensional check flow:

Request arrives for user_42 from IP 10.0.0.5 to /api/search

Check 1: rate_limit:global:user_42          -> 5000 remaining  OK
Check 2: rate_limit:endpoint:user_42:search -> 15 remaining    OK
Check 3: rate_limit:tier:free:user_42       -> 8 remaining     OK
Check 4: rate_limit:ip:10.0.0.5            -> 200 remaining   OK

All checks pass -> ALLOW (report minimum remaining: 8)
```

**Dynamic Rate Limiting**

Static rate limits are set once and apply uniformly. Dynamic rate limiting adjusts limits based on real-time system conditions. When the system is under heavy load (CPU > 80%, response times increasing), dynamically tighten rate limits. When the system is healthy, relax them.

This is essentially adaptive load shedding. Netflix uses this approach: during periods of high demand, their rate limiter becomes progressively stricter, prioritizing paid subscribers over free users and critical endpoints (playback) over non-critical ones (browse recommendations). The rate limiter queries a health endpoint or reads system metrics to make these decisions.

**Rate Limit Exemptions and Overrides**

Every production rate limiter needs an escape hatch. Internal services, health check probes, and certain privileged API keys (like those used by official mobile apps) may need exemption from rate limits. Implement this as a whitelist in the rules engine:

```
exemptions:
  - type: api_key
    keys: [sk_internal_health, sk_mobile_app_v3]
  - type: ip_range
    ranges: [10.0.0.0/8, 172.16.0.0/12]  # internal network
  - type: user_role
    roles: [admin, superuser]
```

Also support temporary overrides: during a product launch, you might temporarily double the rate limit for a specific endpoint. The rules engine should support time-bounded override rules that automatically revert.

**Graceful Degradation**

When a client exceeds their rate limit, a blunt 429 response is not always the best user experience. Consider these graceful degradation strategies: serving cached or stale data instead of a live query (reduce load while still providing value), degrading response quality (return fewer results, lower-resolution images), queueing the request for later processing (for non-real-time operations like analytics or batch jobs), and providing a degraded but functional response with a warning header.

---

### Section 9 — Trade-Offs and Design Decisions

Every design decision in a rate limiter involves trade-offs. A strong interview answer demonstrates awareness of these tensions and the ability to justify a choice based on requirements.

**Accuracy vs Performance**

Perfect accuracy requires global synchronization on every request — expensive and slow. Approximate accuracy (allowing a few extra requests during race conditions or sync delays) is dramatically cheaper. For a payment API, you might insist on perfect accuracy (use Lua scripts, accept the latency). For a content API, approximate accuracy with local counters and periodic sync is perfectly adequate. The question to ask is: what is the cost of allowing 1-5% more requests than intended? For most APIs, the answer is "negligible."

**Centralized vs Distributed Counters**

Centralized (Redis) provides the most accurate global view but introduces a network dependency and a potential single point of failure. Fully distributed (each server tracks independently) is resilient and fast but cannot enforce precise global limits. The hybrid approach — centralized Redis with local fallback — is the most robust. In an interview, state the trade-off clearly and explain that most companies choose centralized Redis because the accuracy benefit outweighs the operational cost of running a Redis cluster.

**Fail-Open vs Fail-Closed**

This is fundamentally a business decision, not a technical one. Ask the interviewer: is it worse to occasionally allow abuse, or to occasionally block legitimate users? For e-commerce APIs, fail-open is almost always correct — blocking a paying customer from completing a purchase is far worse than allowing a few extra API calls. For authentication endpoints, fail-closed is often correct — allowing unlimited login attempts during a Redis outage could enable a credential stuffing attack.

**Per-User vs Per-IP vs Per-API-Key**

Per-user rate limiting is the most fair and precise but requires authentication (unauthenticated endpoints cannot use it). Per-IP rate limiting works for unauthenticated traffic but is problematic with shared IPs (corporate NATs, VPNs, mobile carriers — thousands of legitimate users might share a single IP). Per-API-key is common for developer-facing APIs (like Stripe or Twilio) where each developer registers an API key. The best approach is layered: per-API-key for authenticated requests, per-IP for unauthenticated requests, with special handling for known shared IPs.

**Fixed vs Sliding Window**

Fixed windows are simpler and use less memory but suffer from the boundary problem. Sliding windows (either log or counter) eliminate the boundary problem at the cost of slightly more complexity. For an interview, recommend the sliding window counter as the default: it eliminates the boundary problem with negligible additional complexity and memory cost compared to fixed windows.

**Memory vs Precision**

The sliding window log provides perfect precision but uses O(N) memory per key (where N is the request count in the window). The sliding window counter uses O(1) memory per key but is approximate. The token bucket also uses O(1) memory. For systems tracking millions of keys, the O(1) algorithms are the only practical choice. Reserve the sliding window log for specialized use cases like login attempt tracking, where the number of keys is small and precision matters.

---

### Section 10 — Interview Questions

**Beginner Tier**

**Q1: What happens if you implement rate limiting only on the client side? Why is server-side enforcement necessary?**

Client-side rate limiting is a cooperative mechanism — the client voluntarily limits itself. This is useful for well-behaved official SDKs (like the GitHub Octokit library, which respects `Retry-After` headers), but it cannot be the primary enforcement mechanism. A malicious user can modify the client, use a custom HTTP client, or simply ignore the client-side throttle. Without server-side enforcement, you have no actual protection against abuse. Client-side limiting is an optimization that reduces unnecessary 429 responses for legitimate users; server-side limiting is the security boundary. Always implement server-side enforcement as the authoritative layer, and treat client-side limiting as a complementary courtesy.

**Q2: Explain the boundary problem with fixed window counters and how to solve it.**

The fixed window counter divides time into discrete windows (e.g., 12:00:00-12:00:59, 12:01:00-12:01:59) and counts requests in each. The boundary problem occurs because a user can send their full allowance at the end of one window and again at the start of the next. With a limit of 100 requests/minute, a user could send 100 requests at 12:00:58, then 100 more at 12:01:02, effectively achieving 200 requests in 4 seconds while never exceeding the per-window limit. The solution is to use a sliding window algorithm. The sliding window counter maintains counts for the current and previous fixed windows, then estimates the count using a weighted average: `estimated = previous_count * (1 - elapsed_ratio) + current_count`. This smooths the boundary without significantly increasing memory or complexity. Alternatively, the sliding window log stores individual timestamps and provides perfect precision, but at a higher memory cost.

**Q3: Why is Redis the preferred storage for rate limiting? Could you use a SQL database instead?**

Redis is preferred for three reasons: speed, atomic operations, and automatic key expiration. Redis operates entirely in memory with sub-millisecond latency, which is critical because the rate limiter is in the hot path of every request. Redis provides atomic increment (INCR) and Lua scripting for complex atomic operations, eliminating race conditions without external locking. And Redis TTL-based key expiration handles cleanup automatically — stale rate limit windows delete themselves. A SQL database could technically work (using a table of counters with timestamps), but the latency would be 10-50x higher (5-10ms for a simple query vs 0.1-0.3ms for Redis). At 100K+ QPS, you would need an impractically large database cluster just for rate limiting. A SQL database is a poor fit because rate limit data is ephemeral (expires every window), high-throughput (checked on every request), and does not benefit from relational features like joins or transactions.

**Mid Tier**

**Q4: How would you handle rate limiting in a distributed system with 20 application servers? Walk through the race condition problem and your solution.**

With 20 application servers sharing a rate limit of 100 requests/minute per user, the challenge is maintaining a globally consistent count. All 20 servers must agree on the current count. The solution is a centralized Redis instance that all servers query. However, a naive check-then-increment pattern has a race condition: two servers simultaneously read the count as 99, both allow the request, both increment to 100, resulting in 101 allowed requests.

The fix depends on the algorithm. For fixed window counters, use Redis INCR, which is atomic: `INCR rate_limit:user42:17064` returns the new value. If the new value exceeds the limit, reject the request. The counter might momentarily exceed the limit, but no extra request is served. For more complex algorithms (sliding window counter, token bucket), wrap the entire check-and-update logic in a Lua script. Redis executes Lua scripts atomically — no interleaving is possible. This guarantees that no more than the configured limit of requests is allowed, even under extreme concurrency.

For ultra-high-throughput scenarios where the Redis round-trip (0.3ms) is too expensive, use a hybrid approach: each server maintains a local counter with a proportional share of the limit (100/20 = 5 requests per server), and syncs with Redis every 1-2 seconds to reconcile.

**Q5: Design a multi-dimensional rate limiter that enforces per-user, per-endpoint, and per-IP limits simultaneously. How do you handle the response headers?**

A multi-dimensional rate limiter evaluates multiple rules per request. For a request from user_42 at IP 10.0.0.5 to GET /api/search, you check three keys: `rl:user:42:global` (1000/hour user limit), `rl:user:42:search` (50/hour endpoint limit), and `rl:ip:10.0.0.5` (500/hour IP limit). Use a Redis pipeline to send all three checks in a single network round-trip, reducing latency from 3x to roughly 1x.

The request is allowed only if all checks pass. For response headers, report the most restrictive limit: if the user has 500 remaining globally but only 8 remaining on the search endpoint, `X-RateLimit-Remaining` should show 8, because that is the binding constraint. `X-RateLimit-Limit` shows the limit of the most restrictive rule, and `X-RateLimit-Reset` shows when that specific rule's window resets.

If any dimension is exceeded, the 429 response should indicate which limit was hit (e.g., `"error": "endpoint_rate_limit_exceeded"`) so the client knows whether to back off from a specific endpoint or globally. This is how Stripe structures its rate limit errors — they distinguish between overall rate limits and per-resource limits.

**Q6: Compare token bucket and sliding window counter algorithms. When would you choose each?**

The token bucket allows bursts up to the bucket capacity, then enforces a steady refill rate. It is parameterized by capacity (max burst) and refill rate (sustained throughput). The sliding window counter enforces a smooth limit over a rolling time window with no burst allowance.

Choose token bucket when your use case benefits from burst tolerance. Most API rate limiting falls here: a user who was idle for a minute should be able to make several quick requests. Mobile apps, for example, batch API calls when the app becomes active — the token bucket handles this gracefully. Amazon API Gateway uses token bucket for this reason.

Choose sliding window counter when you need predictable, smooth enforcement. Login attempt limiting is a good example: you do not want to allow a burst of 100 login attempts just because the user was idle. DDoS protection is another: bursts are exactly what you are trying to prevent. Cloudflare uses sliding window counters for their rate limiting product.

The implementation trade-off is minimal — both require similar memory (O(1) per key) and similar complexity. The choice is driven by the use case semantics, not by technical constraints.

**Senior Tier**

**Q7: How would you design a rate limiter that dynamically adjusts limits based on system health? Describe the feedback loop and the risks.**

A dynamic rate limiter monitors system health signals — CPU utilization, response latency percentiles, error rates, queue depths — and adjusts rate limits in real-time. The architecture has three components: a health aggregator that collects metrics from all application servers (via a metrics pipeline like Prometheus), a decision engine that maps health states to rate limit adjustments, and the rate limiter itself which consumes the dynamically computed limits.

The feedback loop works as follows. The health aggregator computes a system health score (0-100). When the score drops below a threshold (e.g., 70), the decision engine triggers progressive limit reduction: first reduce non-critical endpoints by 50%, then reduce free-tier users by 80%, then reduce all users by 50%. As health recovers, limits gradually increase.

The risks are significant. Oscillation is the primary danger: tightening limits reduces load, which improves health, which loosens limits, which increases load, which degrades health — creating a feedback oscillation. Mitigate with hysteresis: only tighten at health score 60, but only loosen at health score 80, creating a dead zone that prevents rapid oscillation. Use gradual ramp-up (increase limits by 10% per minute, not all at once).

A second risk is cascading failure: if the rate limiter aggressively throttles one service, that service's clients may retry, creating a thundering herd when limits loosen. Include jitter in the `Retry-After` header to spread retries over time.

**Q8: Your rate limiter uses Redis, and your Redis cluster experiences a network partition during peak traffic. Walk through what happens and how you would design for this scenario.**

During a network partition, the Redis cluster splits into two groups. Each group believes it is the authoritative copy. In a 3-master Redis Cluster, the partition might isolate one master. That master continues accepting writes for a short time (until `cluster-node-timeout` expires and it realizes it has lost quorum), while the majority side elects a replica to replace it.

During this window (typically 5-15 seconds), rate limit counters can diverge. Application servers talking to the minority side and those talking to the majority side maintain separate counts. A user with a 100/minute limit might get up to 200 requests through (100 counted on each side). After the partition heals, Redis Cluster uses last-writer-wins conflict resolution, which means some counter values may be lost.

Design mitigations: First, use `cluster-node-timeout` of 5 seconds to minimize the divergence window. Second, implement a local rate limiting fallback: if a Redis command fails or times out (indicating a partition), fall back to per-server local counters with a conservative limit (global limit / number of servers). Third, for security-critical endpoints (login, payment), use fail-closed during detected partitions — reject requests rather than risk allowing unlimited attempts. Fourth, after the partition heals, temporarily tighten limits by 50% for one window duration to compensate for the potential over-allowance during the partition. Fifth, monitor and alert on cluster partition events — this should be a page-worthy incident.

**Q9: Design a rate limiting system that handles 1 million QPS with less than 0.5ms of added latency. What architecture changes are needed compared to a standard design?**

At 1 million QPS, a standard centralized-Redis architecture breaks down. Redis peaks at 100-200K ops/sec per node, and each rate check requires 1-2 operations, so you would need 5-10 Redis nodes minimum, with each request requiring a network round-trip.

The architecture shifts to a multi-tier design. Tier 1 is a per-server local rate limiter using in-memory hash maps and the token bucket algorithm. This handles 90% of rate check decisions with zero network overhead (sub-microsecond latency). Each server tracks its proportional share of the global limit. Tier 2 is a periodic sync layer: every 500ms, each server sends its local counts to a central coordinator (Redis Cluster or a dedicated coordination service) and receives updated global counts. The sync is asynchronous and non-blocking — it does not add latency to the request path.

To achieve sub-0.5ms latency, several optimizations are necessary. Use lock-free concurrent data structures for the local rate limiter (e.g., atomic compare-and-swap operations). Keep the rate limit rules in a pre-computed lookup table (hash map keyed by endpoint) to avoid rule evaluation overhead. Use Redis Cluster with at least 6 masters spread across availability zones, with consistent hashing to distribute keys evenly. Pipeline the sync operations so that a single sync batch handles all keys in one round-trip. Consider using a consistent hash ring to partition users across Redis nodes, ensuring even load distribution.

The accuracy trade-off: with 500ms sync intervals and 50 servers, the system might allow up to `limit * (sync_interval / window_size)` extra requests during rapid bursts. For a 1000/minute limit, that is about 8 extra requests (1000 * 0.5/60) — well within acceptable tolerance for most use cases.

---

### Section 11 — Complete Code Example

Below is a production-grade rate limiter implementation in Node.js. It implements both the token bucket and sliding window counter algorithms with Redis as the backing store, Lua scripts for atomicity, and Express middleware integration.

**Token Bucket — Pseudocode**

```
CLASS TokenBucket:
    capacity: int          // Maximum tokens in bucket
    refillRate: float      // Tokens added per second
    store: KeyValueStore   // Redis or in-memory

    FUNCTION allowRequest(key):
        bucket = store.GET(key)

        IF bucket IS NULL:
            // New client — start with full bucket minus one token
            newBucket = {
                tokens: capacity - 1,
                lastRefill: currentTimestamp()
            }
            store.SET(key, newBucket, TTL = capacity / refillRate + 60)
            RETURN {allowed: true, remaining: capacity - 1}

        // Calculate token refill since last request
        elapsed = currentTimestamp() - bucket.lastRefill
        newTokens = elapsed * refillRate
        bucket.tokens = MIN(capacity, bucket.tokens + newTokens)
        bucket.lastRefill = currentTimestamp()

        IF bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            store.SET(key, bucket)
            RETURN {allowed: true, remaining: FLOOR(bucket.tokens)}
        ELSE:
            retryAfter = (1.0 - bucket.tokens) / refillRate
            RETURN {allowed: false, remaining: 0, retryAfter: retryAfter}
```

**Sliding Window Counter — Pseudocode**

```
CLASS SlidingWindowCounter:
    limit: int             // Max requests per window
    windowSize: int        // Window duration in seconds
    store: KeyValueStore   // Redis

    FUNCTION allowRequest(key):
        now = currentTimestamp()
        currentWindow = FLOOR(now / windowSize)
        previousWindow = currentWindow - 1
        elapsedRatio = (now MOD windowSize) / windowSize

        currentKey = key + ":" + currentWindow
        previousKey = key + ":" + previousWindow

        // These two GETs + one INCR must be atomic (use Lua script)
        currentCount = store.GET(currentKey) OR 0
        previousCount = store.GET(previousKey) OR 0

        estimated = previousCount * (1 - elapsedRatio) + currentCount

        IF estimated < limit:
            store.INCR(currentKey)
            store.EXPIRE(currentKey, windowSize * 2)
            remaining = limit - CEIL(estimated) - 1
            RETURN {allowed: true, remaining: MAX(0, remaining)}
        ELSE:
            resetTime = (currentWindow + 1) * windowSize
            retryAfter = resetTime - now
            RETURN {allowed: false, remaining: 0, retryAfter: retryAfter}
```

**Full Node.js Implementation**

```javascript
// rate-limiter.js
// Production-grade rate limiter with Token Bucket and Sliding Window Counter
// Requires: npm install ioredis express

const Redis = require('ioredis');
const express = require('express');

// ------------------------------------------------------------------
// 1. Redis Connection Setup
// ------------------------------------------------------------------
// Create a Redis client connected to the local Redis instance.
// In production, this would point to a Redis Cluster with sentinels.
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  // Enable auto-pipelining: ioredis batches multiple commands
  // sent in the same event loop tick into a single pipeline,
  // reducing round-trips under concurrent load.
  enableAutoPipelining: true,
  // Connection retry strategy: wait 100ms, then 200ms, etc.
  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  },
});

// ------------------------------------------------------------------
// 2. Lua Script: Token Bucket (Atomic)
// ------------------------------------------------------------------
// This Lua script runs atomically inside Redis. No other command
// can execute between the GET and SET, eliminating race conditions.
//
// KEYS[1]: The rate limit key (e.g., "rl:user42:api")
// ARGV[1]: Bucket capacity (max tokens)
// ARGV[2]: Refill rate (tokens per second)
// ARGV[3]: Current timestamp in seconds (floating point)
//
// Returns: [allowed (0/1), remaining tokens, retry-after seconds]
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Retrieve current bucket state from Redis
local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(bucket[1])
local lastRefill = tonumber(bucket[2])

-- If key does not exist, initialize a full bucket
if tokens == nil then
    tokens = capacity
    lastRefill = now
end

-- Calculate how many tokens to add since last refill
local elapsed = math.max(0, now - lastRefill)
local tokensToAdd = elapsed * refillRate
tokens = math.min(capacity, tokens + tokensToAdd)
lastRefill = now

-- Attempt to consume one token
if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
    -- Set TTL to auto-expire the key if unused.
    -- TTL = time to fully refill + buffer.
    redis.call('EXPIRE', key, math.ceil(capacity / refillRate) + 60)
    return {1, math.floor(tokens), 0}
else
    -- Not enough tokens. Calculate time until one token is available.
    redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
    redis.call('EXPIRE', key, math.ceil(capacity / refillRate) + 60)
    local retryAfter = math.ceil((1 - tokens) / refillRate)
    return {0, 0, retryAfter}
end
`;

// ------------------------------------------------------------------
// 3. Lua Script: Sliding Window Counter (Atomic)
// ------------------------------------------------------------------
// Implements the hybrid sliding window using two fixed-window
// counters and a weighted estimate.
//
// KEYS[1]: Current window key (e.g., "rl:user42:api:17064")
// KEYS[2]: Previous window key (e.g., "rl:user42:api:17063")
// ARGV[1]: Request limit for the window
// ARGV[2]: Window size in seconds
// ARGV[3]: Current timestamp in seconds
//
// Returns: [allowed (0/1), remaining, retry-after seconds]
const SLIDING_WINDOW_SCRIPT = `
local currentKey = KEYS[1]
local previousKey = KEYS[2]
local limit = tonumber(ARGV[1])
local windowSize = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Determine where we are within the current window (0.0 to 1.0)
local currentWindow = math.floor(now / windowSize)
local elapsedRatio = (now - currentWindow * windowSize) / windowSize

-- Fetch counts from both windows
local currentCount = tonumber(redis.call('GET', currentKey) or "0") or 0
local previousCount = tonumber(redis.call('GET', previousKey) or "0") or 0

-- Weighted estimate: the portion of the previous window that overlaps
-- with our sliding window contributes proportionally.
local estimatedCount = previousCount * (1 - elapsedRatio) + currentCount

if estimatedCount < limit then
    -- Allow the request: increment current window counter
    redis.call('INCR', currentKey)
    -- Set TTL to 2x window size so the previous window is still
    -- available for the next window's calculation.
    redis.call('EXPIRE', currentKey, windowSize * 2)
    local remaining = math.max(0, limit - math.ceil(estimatedCount) - 1)
    return {1, remaining, 0}
else
    -- Reject: calculate when the current window resets
    local resetTime = (currentWindow + 1) * windowSize
    local retryAfter = math.ceil(resetTime - now)
    return {0, 0, retryAfter}
end
`;

// ------------------------------------------------------------------
// 4. RateLimiter Class
// ------------------------------------------------------------------
// Encapsulates both algorithms and provides a clean interface.
class RateLimiter {
  /**
   * @param {object} options
   * @param {Redis}  options.redisClient   - ioredis client instance
   * @param {string} options.algorithm     - 'token_bucket' or 'sliding_window'
   * @param {number} options.limit         - Max requests per window (sliding)
   *                                         or bucket capacity (token bucket)
   * @param {number} options.windowSize    - Window in seconds (sliding window)
   * @param {number} options.refillRate    - Tokens/sec (token bucket)
   * @param {string} options.keyPrefix     - Prefix for Redis keys
   */
  constructor(options) {
    this.redis = options.redisClient;
    this.algorithm = options.algorithm || 'sliding_window';
    this.limit = options.limit || 100;
    this.windowSize = options.windowSize || 60; // 60 seconds
    this.refillRate = options.refillRate || (this.limit / this.windowSize);
    this.keyPrefix = options.keyPrefix || 'rl';

    // Pre-load the appropriate Lua script into Redis.
    // defineCommand registers the script once and caches its SHA,
    // so subsequent calls use EVALSHA (faster than EVAL).
    if (this.algorithm === 'token_bucket') {
      this.redis.defineCommand('tokenBucketCheck', {
        numberOfKeys: 1,
        lua: TOKEN_BUCKET_SCRIPT,
      });
    } else {
      this.redis.defineCommand('slidingWindowCheck', {
        numberOfKeys: 2,
        lua: SLIDING_WINDOW_SCRIPT,
      });
    }
  }

  /**
   * Build the Redis key for a given client identifier.
   * For sliding window, returns both current and previous window keys.
   *
   * @param {string} identifier - e.g., "user:42" or "ip:10.0.0.5"
   * @returns {string|string[]} Redis key(s)
   */
  _buildKey(identifier) {
    if (this.algorithm === 'token_bucket') {
      // Token bucket uses a single key per identifier
      return `${this.keyPrefix}:tb:${identifier}`;
    } else {
      // Sliding window needs current and previous window keys.
      // Use Redis hash tags {identifier} to ensure both keys
      // land on the same Redis Cluster node (required for Lua).
      const now = Date.now() / 1000;
      const currentWindow = Math.floor(now / this.windowSize);
      const previousWindow = currentWindow - 1;
      return [
        `${this.keyPrefix}:sw:{${identifier}}:${currentWindow}`,
        `${this.keyPrefix}:sw:{${identifier}}:${previousWindow}`,
      ];
    }
  }

  /**
   * Check whether a request should be allowed.
   *
   * @param {string} identifier - Client identifier
   * @returns {Promise<{allowed: boolean, remaining: number,
   *           retryAfter: number, limit: number, resetTime: number}>}
   */
  async check(identifier) {
    const now = Date.now() / 1000; // Current time in seconds

    try {
      let result;

      if (this.algorithm === 'token_bucket') {
        const key = this._buildKey(identifier);
        // Call the Lua script atomically in Redis.
        // Returns [allowed, remaining, retryAfter].
        result = await this.redis.tokenBucketCheck(
          key,                  // KEYS[1]
          this.limit,           // ARGV[1] = capacity
          this.refillRate,      // ARGV[2] = refill rate
          now                   // ARGV[3] = current timestamp
        );
      } else {
        const [currentKey, previousKey] = this._buildKey(identifier);
        result = await this.redis.slidingWindowCheck(
          currentKey,           // KEYS[1]
          previousKey,          // KEYS[2]
          this.limit,           // ARGV[1] = limit
          this.windowSize,      // ARGV[2] = window size
          now                   // ARGV[3] = current timestamp
        );
      }

      // Parse the Lua script response
      const [allowed, remaining, retryAfter] = result;

      // Calculate when the current window resets
      const currentWindow = Math.floor(now / this.windowSize);
      const resetTime = (currentWindow + 1) * this.windowSize;

      return {
        allowed: allowed === 1,
        remaining: remaining,
        retryAfter: retryAfter,
        limit: this.limit,
        resetTime: Math.ceil(resetTime),
      };
    } catch (error) {
      // ----------------------------------------------------------
      // FAIL-OPEN: If Redis is unavailable, allow the request.
      // Log the error for alerting. In production, consider
      // falling back to a local in-memory rate limiter.
      // ----------------------------------------------------------
      console.error(`Rate limiter Redis error: ${error.message}`);
      return {
        allowed: true,
        remaining: -1,         // Unknown
        retryAfter: 0,
        limit: this.limit,
        resetTime: 0,
      };
    }
  }
}

// ------------------------------------------------------------------
// 5. Express Middleware Factory
// ------------------------------------------------------------------
// Creates an Express middleware that applies rate limiting to every
// request passing through it. Attach it to specific routes or
// globally via app.use().
//
// @param {object} options - Same options as RateLimiter, plus:
//   @param {function} options.keyGenerator - (req) => string
//       Function to extract the client identifier from the request.
//       Defaults to IP address.
function rateLimiterMiddleware(options = {}) {
  // Default key generator: use the client's IP address.
  // In production, prefer user ID from auth token when available.
  const keyGenerator = options.keyGenerator || ((req) => {
    return req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
  });

  // Instantiate the rate limiter
  const limiter = new RateLimiter({
    redisClient: options.redisClient || redis,
    algorithm: options.algorithm || 'sliding_window',
    limit: options.limit || 100,
    windowSize: options.windowSize || 60,
    refillRate: options.refillRate,
    keyPrefix: options.keyPrefix || 'rl',
  });

  // Return the Express middleware function
  return async (req, res, next) => {
    // Step 1: Extract the client identifier from the request
    const identifier = keyGenerator(req);

    // Step 2: Perform the rate limit check against Redis
    const result = await limiter.check(identifier);

    // Step 3: Always set rate limit headers on the response,
    // regardless of whether the request is allowed or denied.
    // This lets clients self-throttle proactively.
    res.set('X-RateLimit-Limit', String(result.limit));
    res.set('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
    res.set('X-RateLimit-Reset', String(result.resetTime));

    // Step 4: If the request is allowed, proceed to the next
    // middleware/route handler.
    if (result.allowed) {
      return next();
    }

    // Step 5: Request denied — return 429 with Retry-After header
    res.set('Retry-After', String(result.retryAfter));
    return res.status(429).json({
      error: 'rate_limit_exceeded',
      message: `Rate limit of ${result.limit} requests exceeded. ` +
               `Try again in ${result.retryAfter} seconds.`,
      retryAfter: result.retryAfter,
    });
  };
}

// ------------------------------------------------------------------
// 6. Example Express Application
// ------------------------------------------------------------------
// Demonstrates how to apply the rate limiter middleware.
const app = express();

// Apply global rate limiting: 100 requests per minute per IP
// using the sliding window counter algorithm.
app.use(rateLimiterMiddleware({
  algorithm: 'sliding_window',
  limit: 100,
  windowSize: 60,
  keyPrefix: 'rl:global',
}));

// Apply stricter rate limiting to the login endpoint:
// 5 requests per minute per IP, using token bucket for
// zero burst tolerance on auth endpoints.
app.post('/api/login', rateLimiterMiddleware({
  algorithm: 'token_bucket',
  limit: 5,
  windowSize: 60,
  refillRate: 5 / 60,    // ~0.083 tokens per second
  keyPrefix: 'rl:login',
}), (req, res) => {
  res.json({ message: 'Login endpoint' });
});

// A standard API endpoint protected by the global rate limiter
app.get('/api/data', (req, res) => {
  res.json({ message: 'Data endpoint', timestamp: Date.now() });
});

// ------------------------------------------------------------------
// 7. Multi-Dimensional Rate Limiting Example
// ------------------------------------------------------------------
// Apply multiple rate limiters to a single endpoint.
// The request must pass ALL limiters to be allowed.
function multiDimensionalRateLimit(...limiters) {
  return async (req, res, next) => {
    // Run all rate limit checks in parallel using Promise.all.
    // This makes a single Redis pipeline round-trip if
    // auto-pipelining is enabled.
    const results = await Promise.all(
      limiters.map(limiter => limiter(req, res, () => {}))
    );

    // Find the most restrictive result.
    // If any limiter has already sent a 429 response, stop.
    if (res.headersSent) {
      return; // A limiter already rejected the request
    }

    // All limiters passed — proceed
    next();
  };
}

// ------------------------------------------------------------------
// 8. Health Check Endpoint (exempt from rate limiting)
// ------------------------------------------------------------------
// Health probes must never be rate-limited.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ------------------------------------------------------------------
// 9. Start Server
// ------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Rate limiter using Redis at ${redis.options.host}:${redis.options.port}`);
});

// Export for testing
module.exports = { RateLimiter, rateLimiterMiddleware };
```

**Line-by-Line Explanation of Key Sections**

The Redis connection (Section 1) uses `enableAutoPipelining`, which is a critical optimization. When multiple rate limit checks happen concurrently (common under load), ioredis batches them into a single Redis pipeline automatically. This means 50 concurrent rate checks result in 1 network round-trip instead of 50.

The Lua scripts (Sections 2 and 3) are the most important part of the implementation. By running inside Redis, they guarantee atomicity without distributed locks. The `defineCommand` method registers the script once and caches its SHA1 hash. Subsequent calls use `EVALSHA` instead of `EVAL`, saving bandwidth by not retransmitting the script text.

In the token bucket Lua script, the line `tokens = math.min(capacity, tokens + tokensToAdd)` is the refill cap. Without `math.min`, a user who is idle for a long time would accumulate unbounded tokens, allowing an enormous burst. The cap ensures the maximum burst is always equal to the bucket capacity.

The sliding window script uses `{identifier}` hash tag syntax in the key names. This is essential for Redis Cluster: keys with the same hash tag are guaranteed to reside on the same node, which is required for Lua scripts that access multiple keys.

The fail-open pattern in the `check` method (the catch block) is a deliberate design choice. When Redis is unreachable, the rate limiter allows requests through rather than blocking them. The `remaining: -1` sentinel value signals to monitoring that the rate limiter is operating in degraded mode.

The middleware factory (Section 5) separates the key generation concern from the rate limiting logic. By default, it uses the client IP, but in production you would typically override this to use an authenticated user ID: `keyGenerator: (req) => req.user.id`. This single change switches from per-IP to per-user rate limiting.

---

### Section 12 — Connection to Next Topic

Throughout this topic, one technology appeared again and again at the center of every design decision: Redis. It is the counter store, the atomic operation engine, the TTL-based garbage collector, and the cluster coordination backbone of the rate limiter. We chose Redis because it provides sub-millisecond in-memory access, rich data structures (strings, hashes, sorted sets), atomic Lua scripting, and built-in clustering with replication.

But we took Redis for granted. We assumed a key-value store exists that can handle hundreds of thousands of operations per second, automatically expire keys, replicate data across nodes, and survive failures. What if you had to build that store yourself?

That is exactly the challenge of Topic 43: **Design a Key-Value Store**. Where this topic asked "how do we use a key-value store effectively," the next topic asks "how do we build one from scratch." You will explore storage engines (LSM trees vs B-trees), write-ahead logs for durability, consistent hashing for data partitioning, replication strategies (leader-follower, leaderless), and the CAP theorem trade-offs that determine whether your store prioritizes consistency or availability.

The rate limiter gives you concrete intuition for what a key-value store's clients need: predictable low latency, atomic read-modify-write operations, automatic key expiration, and graceful behavior under failure. Carry these requirements forward as you design the store that would power the rate limiter we just built. The two topics together form a complete picture: the consumer and the infrastructure it depends on.

---

*Prerequisites: Topics 1-3 (Fundamentals), Topic 10 (Caching), Topic 15 (Load Balancing), Topic 18 (API Design)*
*Next: Topic 43 — Design a Key-Value Store*

---

<!--
Topic: 43
Title: Design a Key-Value Store
Section: 09 — Real-World Designs Part 1
Track: 0-to-100 Deep Mastery
Difficulty: mid-senior
Interview Weight: high
Prerequisites: Topics 6-10, 19, 29-31
Next: Topic 44 (Design a Distributed Cache)
Version: 1.0
-->

## Topic 43: Design a Key-Value Store

---

### Section 1 — Why This Design?

In 2007, Werner Vogels and his team at Amazon published the Dynamo paper, and it changed the trajectory of distributed systems engineering. Amazon had hit a wall: their relational databases could not keep up with the scale of shopping cart operations during peak traffic. The insight was radical for its time — most of those operations did not need the full power of SQL. They needed to store a blob of data under a key, retrieve it by that key, and do so with single-digit millisecond latency at massive scale. The Dynamo paper laid out a blueprint for a distributed key-value store that sacrificed strong consistency in favor of availability, and in doing so, it became the intellectual ancestor of Cassandra, Riak, DynamoDB, and an entire generation of NoSQL systems.

But the story starts even earlier. In 2003, Brad Fitzpatrick created Memcached to solve a caching problem at LiveJournal. It was a distributed, in-memory hash table — nothing more, nothing less. It proved that a system with a trivially simple API (get, set, delete) could have an outsized impact on the performance of web applications. Then in 2009, Salvatore Sanfilippo released Redis, which extended the key-value model with rich data structures (lists, sets, sorted sets, hashes) while keeping the same sub-millisecond performance. Meanwhile, Google's LevelDB and Facebook's RocksDB pioneered the LSM-tree storage engine that made persistent key-value stores wickedly fast for write-heavy workloads. And etcd, the key-value store that underpins Kubernetes, proved that even strongly consistent key-value stores are essential infrastructure when you need a reliable source of truth for cluster state.

Why does this matter for your interview? Because the key-value store is the fundamental building block of nearly every distributed system. Databases use them internally as storage engines. Caches are key-value stores with eviction policies. Configuration systems, service discovery, session management, feature flags — all key-value stores in disguise. When an interviewer asks you to design a key-value store, they are testing your understanding of storage engines, distributed consensus, partitioning, replication, consistency models, and failure handling. It is arguably the single most important system design question at the senior level because every concept you demonstrate can be transferred to dozens of other designs. If you can design a key-value store well, you can design almost anything.

---

### Section 2 — Requirements Gathering

Every system design interview begins with clarifying requirements, and the key-value store question is deceptively open-ended. You must drive the conversation to pin down exactly what kind of key-value store you are building, because the design for an in-memory cache is drastically different from the design for a persistent, distributed data store.

**Functional Requirements**

The core API is minimal but precise:

- `put(key, value)` — Store a value under the given key. If the key already exists, overwrite the previous value. Return a success/failure indication.
- `get(key)` — Retrieve the value associated with the given key. Return null or an error if the key does not exist.
- `delete(key)` — Remove the key-value pair. In an LSM-tree based system, this is typically a tombstone write rather than an immediate deletion.
- `TTL support` — Allow callers to set an expiration time on keys, after which the data is automatically purged.

Beyond the basic CRUD operations, discuss optional features depending on time: range queries (if keys are ordered), batch operations, compare-and-swap (CAS) for atomic updates, and versioning for conflict detection.

**Non-Functional Requirements**

These are where the real design decisions live:

- **High availability**: The system must remain operational even when individual nodes fail. Target 99.99% availability (roughly 52 minutes of downtime per year). This pushes us toward an AP design in CAP theorem terms, though we want tunable consistency.
- **Low latency**: p50 under 1ms for reads, p99 under 10ms. This rules out designs that require synchronous cross-datacenter coordination for every request.
- **Scalability**: The system must scale horizontally to handle petabytes of data and hundreds of thousands of operations per second. Adding nodes should increase capacity linearly.
- **Tunable consistency**: Some callers need strong consistency (e.g., a distributed lock), while others are fine with eventual consistency (e.g., a user profile cache). The system should let callers choose.
- **Durability**: Once a write is acknowledged, the data must not be lost even if a node crashes immediately afterward.

**Back-of-Envelope Estimation**

Let us work through realistic numbers for a production key-value store:

```
Throughput:
  - 100,000 operations/second (70% reads, 30% writes)
  - Read ops:  70,000/sec
  - Write ops: 30,000/sec

Data sizes:
  - Average key size:   256 bytes
  - Average value size: 10 KB
  - Average pair size:  ~10.25 KB (call it 10 KB for simplicity)

Storage:
  - Total key-value pairs: 1 billion (10^9)
  - Raw data: 1 billion * 10 KB = 10 TB
  - With replication factor 3: 30 TB
  - With compaction overhead (~30%): ~39 TB total disk

Write bandwidth:
  - 30,000 writes/sec * 10 KB = 300 MB/sec ingress
  - With replication factor 3: 900 MB/sec across the cluster

Memory for memtable (per node):
  - If we have 20 nodes, each handles ~1,500 writes/sec
  - Memtable flush threshold: 64 MB
  - Time to fill memtable: 64 MB / (1,500 * 10 KB) = ~4.3 seconds
  - Keep 2 memtables in memory (active + flushing): 128 MB per node

Bloom filter memory:
  - 10 bits per key, 1 billion keys / 20 nodes = 50 million keys per node
  - 50 million * 10 bits = 500 Mb = ~62.5 MB per node

Node count:
  - 39 TB / 2 TB per node (usable SSD) = ~20 nodes
  - Each node: 2 TB SSD, 8 GB RAM (memtable + bloom filters + OS cache),
    8 cores, 10 Gbps NIC
```

These numbers demonstrate that a key-value store at this scale is well within the capacity of a modest cluster. The critical constraints are write amplification from LSM compaction and the network bandwidth for replication, both of which inform our design decisions.

---

### Section 3 — High-Level Architecture

We will build this design in two phases: first a single-node architecture that establishes the storage engine fundamentals, and then the distributed layer that adds partitioning, replication, and fault tolerance.

**Single-Node Architecture**

A single-node key-value store has three main components operating in concert:

```
                          Client Request
                               |
                               v
                    +---------------------+
                    |   API Layer (RPC)    |
                    +---------------------+
                               |
              +----------------+----------------+
              |                                 |
              v                                 v
     +----------------+               +------------------+
     |   Memtable     |               |  Bloom Filters   |
     | (Red-Black Tree|               | (per SSTable)    |
     |  or Skip List) |               +------------------+
     +----------------+                        |
         |        |                            v
         |        |                   +------------------+
         |        +--- flush -------->|   SSTables       |
         |                            | (Sorted String   |
         v                            |  Tables on Disk) |
     +----------------+               +------------------+
     | Write-Ahead    |                        |
     | Log (WAL)      |               +------------------+
     +----------------+               | Compaction Engine |
                                      +------------------+
```

When a write arrives, the system first appends it to the write-ahead log (WAL) on disk. This is a sequential write, which is fast on both HDDs and SSDs. The WAL exists solely for durability — if the node crashes before the memtable is flushed to disk, we replay the WAL on startup to recover the in-memory state. After the WAL append, the key-value pair is inserted into the memtable, which is an in-memory sorted data structure (typically a skip list or red-black tree). The write is now acknowledged to the client.

When a read arrives, the system checks the memtable first (since it contains the most recent writes). If the key is not found there, it checks the SSTables on disk, starting from the most recent. Bloom filters sit in front of each SSTable and answer the question "is this key definitely NOT in this SSTable?" with zero disk I/O. A negative bloom filter result lets us skip the SSTable entirely.

When the memtable grows beyond a threshold (e.g., 64 MB), it is frozen and a new empty memtable takes its place. The frozen memtable is flushed to disk as an SSTable — a file where keys are sorted and indexed for efficient lookup. Over time, SSTables accumulate and a background compaction process merges them, removing deleted keys (tombstones) and obsolete versions to reclaim space and keep read performance bounded.

**Distributed Architecture**

Scaling beyond one node requires three capabilities: partitioning (splitting data across nodes), replication (copying data for durability and read throughput), and coordination (routing requests to the right nodes).

```
                        +-------------------+
                        |    Client SDK     |
                        | (aware of ring    |
                        |  topology)        |
                        +-------------------+
                                |
                  +-------------+-------------+
                  |             |             |
                  v             v             v
            +---------+  +---------+  +---------+
            | Node A  |  | Node B  |  | Node C  |
            | VN: 3,7 |  | VN: 1,5 |  | VN: 2,8 |
            +---------+  +---------+  +---------+
            | Engine  |  | Engine  |  | Engine  |
            | WAL     |  | WAL     |  | WAL     |
            | MemTbl  |  | MemTbl  |  | MemTbl  |
            | SST     |  | SST     |  | SST     |
            +---------+  +---------+  +---------+
                  |             |             |
                  +------+------+------+------+
                         |             |
                    +---------+  +---------+
                    | Node D  |  | Node E  |
                    | VN: 4,9 |  | VN: 6,0 |
                    +---------+  +---------+
```

The hash ring maps each key to a position on a circular hash space. Consistent hashing assigns each physical node multiple virtual nodes (VN) on the ring, which ensures even distribution of keys even when nodes join or leave. A key is stored on the first N nodes clockwise from its position on the ring, where N is the replication factor.

The data flow for a write request works as follows: The client (or a coordinator node) hashes the key to find its position on the ring. It identifies the N replica nodes responsible for that key. It sends the write to all N replicas in parallel. Based on the configured write quorum W, it waits for W acknowledgments before returning success to the client. If W = 1, this is a fast but weakly durable write. If W = N, every replica must confirm. The typical choice is W = floor(N/2) + 1 for quorum writes.

For reads, the coordinator sends the request to all N replicas in parallel, waits for R responses (the read quorum), and returns the value with the highest version number or timestamp. If R + W > N, the system guarantees that reads and writes overlap on at least one node, providing strong consistency. If R + W <= N, you get higher availability and lower latency but only eventual consistency.

---

### Section 4 — Deep Dive: Storage Engine

The storage engine is the heart of any key-value store. It determines your write throughput, read latency, space amplification, and operational characteristics. The two dominant approaches are LSM-trees and B-trees, and understanding their trade-offs is essential for any senior-level interview.

**LSM-Tree (Log-Structured Merge Tree)**

The LSM-tree is optimized for write-heavy workloads. Its central insight is that sequential disk writes are orders of magnitude faster than random writes — roughly 100 MB/sec sequential vs 1 MB/sec random on a typical SSD (and the gap is far wider on spinning disks). By batching writes in memory and flushing them as sorted runs to disk, the LSM-tree converts random writes into sequential writes.

The architecture has three layers. The first layer is the WAL (write-ahead log), an append-only file on disk. Every write is first recorded here before touching memory. The WAL is purely a durability mechanism — it is never read during normal operations, only during crash recovery. Because it is append-only, writes to the WAL are sequential and fast.

The second layer is the memtable, a sorted in-memory data structure. Skip lists are the most common choice (used by LevelDB, RocksDB, and Cassandra) because they support concurrent reads and writes without global locks. Red-black trees are an alternative but are harder to make lock-free. When a write arrives, it is inserted into the memtable in O(log n) time. Reads check the memtable first, also in O(log n) time.

The third layer is the collection of SSTables on disk. When the memtable reaches its size threshold, it is frozen and flushed to disk as an SSTable. An SSTable is an immutable file containing key-value pairs sorted by key, along with an index block and a bloom filter. Because the keys are sorted, lookups within an SSTable use binary search on the index.

**Compaction** is the background process that keeps the LSM-tree healthy. Without compaction, you would accumulate thousands of SSTables and reads would degrade because you might need to check each one. There are two main compaction strategies:

- *Size-tiered compaction*: SSTables of similar sizes are merged together. This is simple and write-friendly but can temporarily double space usage during compaction. Cassandra defaults to this.
- *Leveled compaction*: SSTables are organized into levels (L0, L1, L2, ...). Each level has a size limit, and when a level overflows, its SSTables are merged into the next level. This bounds space amplification and read amplification at the cost of higher write amplification. LevelDB and RocksDB use this approach.

**Write amplification** is the ratio of actual bytes written to disk versus the bytes the user intended to write. In a leveled compaction scheme, a single user write might be rewritten 10-30 times as it is compacted through levels. This is the primary cost of the LSM-tree approach.

**B-Tree**

The B-tree is the traditional workhorse of databases. It stores data in fixed-size pages (typically 4 KB or 16 KB) organized as a balanced tree. Reads follow pointers from the root page down to the leaf page containing the key, requiring O(log n) page reads where n is the number of keys and the base of the logarithm is the branching factor (typically 100-500). This means even a B-tree with billions of keys needs only 3-4 levels of pages, and since the upper levels are typically cached in memory, most reads require only 1-2 disk I/Os.

Writes in a B-tree are in-place updates: you find the page containing the key and overwrite it. This creates random I/O patterns that are slower than the sequential writes of an LSM-tree. However, write amplification is lower (typically 2-5x) because data is only written to its final location plus possibly the WAL, without the repeated merging that LSM compaction requires.

**LSM-Tree vs B-Tree: When to Choose Which**

| Factor               | LSM-Tree             | B-Tree                |
|---------------------|----------------------|-----------------------|
| Write throughput     | Higher (sequential)  | Lower (random I/O)   |
| Read latency         | Higher (check levels)| Lower (direct lookup) |
| Space amplification  | Lower with leveled   | Higher (page splits)  |
| Write amplification  | Higher (compaction)  | Lower (in-place)      |
| Concurrency          | Simpler (immutable)  | Complex (page locks)  |
| Range queries        | Good (sorted runs)   | Good (sorted leaves)  |
| Best for             | Write-heavy workloads| Read-heavy workloads  |

For our key-value store design, we choose the LSM-tree because our workload has 30% writes (which is substantial), we need high write throughput for the replication layer, and the write amplification trade-off is acceptable given modern SSDs.

**Bloom Filters**

A Bloom filter is a probabilistic data structure that answers set membership queries with no false negatives and a small false positive rate. For each SSTable, we build a bloom filter containing all keys in that table. When a read request arrives and the key is not in the memtable, we check the bloom filter for each SSTable before actually reading from disk. If the bloom filter says "no," the key is definitely not in that SSTable and we skip it. If the bloom filter says "yes," the key might be there and we do the disk lookup.

With 10 bits per key and 7 hash functions, a Bloom filter achieves roughly a 1% false positive rate. This means that 99% of unnecessary SSTable lookups are avoided, which is critical for read performance in an LSM-tree where you might have dozens of SSTables.

**How RocksDB Implements This**

RocksDB (Facebook's fork of LevelDB) is the industry-standard LSM-tree implementation and powers systems like CockroachDB, TiKV, and many internal services at Facebook, Netflix, and Uber. Its architecture closely mirrors what we have described: a WAL, a memtable implemented as a concurrent skip list, SSTables organized in levels with leveled or universal compaction, per-SSTable bloom filters, and a block cache for frequently accessed SSTable blocks. RocksDB adds several optimizations: column families for logical separation of data within a single store, prefix bloom filters for efficient prefix scans, merge operators for atomic read-modify-write operations, and rate limiters to control compaction I/O impact on foreground operations.

---

### Section 5 — Partitioning and Replication

A single node cannot hold 10 TB of data or handle 100,000 operations per second. Partitioning splits the data across multiple nodes, and replication copies each partition to multiple nodes for durability and availability.

**Consistent Hashing with Virtual Nodes**

The naive approach to partitioning is modular hashing: `node = hash(key) % N`. This is catastrophic when the number of nodes changes, because nearly every key must be relocated. Consistent hashing solves this by placing both nodes and keys on a hash ring (a circular space from 0 to 2^128 - 1). Each key is assigned to the first node encountered when walking clockwise around the ring from the key's hash position.

The problem with basic consistent hashing is that nodes are unevenly distributed on the ring, leading to hot spots. Virtual nodes fix this: each physical node is represented by multiple virtual nodes (e.g., 256) scattered around the ring. When a physical node is added or removed, only its virtual nodes' segments are redistributed, and since they are numerous and evenly distributed, the rebalancing is smooth.

```
Hash Ring with Virtual Nodes:

            VN_A1
           /      \
      VN_C2        VN_B1
      /                \
  VN_B3                VN_A2
      \                /
      VN_A3        VN_C1
           \      /
            VN_B2

Physical Node A owns: VN_A1, VN_A2, VN_A3
Physical Node B owns: VN_B1, VN_B2, VN_B3
Physical Node C owns: VN_C1, VN_C2

Key "user:123" hashes to position between VN_B1 and VN_A2
  -> Primary replica: Node A (owns VN_A2)
  -> Next clockwise: Node C (owns VN_C1)
  -> Next clockwise: Node B (owns VN_B2)
  -> Replicas: [A, C, B] with replication factor N=3
```

When a new node D is added, it receives virtual nodes that split existing segments. Only the data in those segments needs to be transferred, roughly 1/N of the total data. Conversely, when a node is removed, its segments are absorbed by adjacent nodes on the ring.

**Replication: N, W, R**

Every key-value pair is stored on N replica nodes (the replication factor, typically 3). The write quorum W and read quorum R determine the consistency and availability trade-offs:

- **R=1, W=1**: Fastest but weakest. A single node's response suffices for both reads and writes. No consistency guarantee — you might read stale data.
- **R=1, W=N**: Writes are slow (all replicas must confirm) but reads are fast. Writes tolerate zero failures.
- **R=N, W=1**: Writes are fast but reads are slow. Reads tolerate zero failures.
- **R=2, W=2 (with N=3)**: Quorum. R + W > N guarantees overlap. Tolerates one failed node for both reads and writes. This is the most common production configuration.

The math is clear: if R + W > N, at least one node that acknowledged the write will be in the set of nodes that respond to a read, guaranteeing that the latest write is seen. If R + W <= N, there is no such guarantee, and you get eventual consistency.

**Sloppy Quorum and Hinted Handoff**

Strict quorum enforcement hurts availability: if one of the three replicas is down and W=2, writes still succeed, but if two are down, writes fail. A sloppy quorum relaxes this by allowing writes to be sent to any N healthy nodes from the hash ring, even if they are not the designated replicas for that key. The non-designated node stores the data temporarily and includes a "hint" indicating the intended recipient. When the intended node recovers, the hint is replayed and the data is transferred — this is hinted handoff.

This mechanism is straight from the Amazon Dynamo paper and is critical for maintaining write availability during partial failures. The trade-off is that reads from the designated replicas may temporarily miss the data that was written to a non-designated node, widening the window of inconsistency.

**Anti-Entropy with Merkle Trees**

Hinted handoff works for brief outages, but what if a node is down for hours and misses thousands of writes? The system needs a mechanism to detect and repair divergence between replicas. This is anti-entropy, and the tool of choice is the Merkle tree.

A Merkle tree is a hash tree where every leaf node contains the hash of a data block (in our case, a range of key-value pairs), and every internal node contains the hash of its children. Two nodes can compare their Merkle tree roots to instantly determine whether their data is identical. If the roots differ, they recursively compare child hashes to identify exactly which key ranges have diverged, and then transfer only the differing data. This is dramatically more efficient than comparing every key-value pair.

Each node periodically builds Merkle trees over its key ranges and exchanges root hashes with replica peers. When a previously-failed node returns, the Merkle tree comparison identifies the exact set of keys that need to be resynchronized, and only those are transferred.

**Handling Node Failures**

Putting it all together, the system handles failures at three timescales:

1. **Transient failures (seconds to minutes)**: Sloppy quorum and hinted handoff keep writes available. Reads may return slightly stale data.
2. **Medium-term failures (minutes to hours)**: Anti-entropy Merkle trees detect and repair data divergence when the node returns.
3. **Permanent failures (node loss)**: The system detects the failure (via gossip protocol), removes the node from the ring, and re-replicates its data to new nodes to restore the replication factor.

---

### Section 6 — Conflict Resolution

In a distributed key-value store that favors availability over consistency, concurrent writes to the same key on different replicas are inevitable. The system needs a strategy to detect and resolve these conflicts.

**Last-Write-Wins (LWW)**

The simplest approach is to attach a timestamp to every write and, when two versions conflict, keep the one with the higher timestamp. This is the default in Cassandra and DynamoDB. It is simple to implement and reason about, but it has a critical flaw: it silently drops data. If two clients concurrently update the same key, one update is permanently lost with no notification. Clock skew between nodes can also cause causally later writes to have earlier timestamps, leading to counter-intuitive behavior. Despite these drawbacks, LWW is widely used because many applications can tolerate occasional silent data loss, and the alternative mechanisms add significant complexity.

To mitigate clock skew, systems typically use hybrid logical clocks (HLC), which combine physical timestamps with logical counters. An HLC is always at least as large as the physical clock and always increases across causally related events. This ensures that if event A causally precedes event B, HLC(A) < HLC(B), even if the physical clocks are skewed.

**Vector Clocks for Causality Tracking**

A vector clock is a list of (node, counter) pairs — one entry per replica that has written to the key. When node A writes, it increments its own counter. When a node receives a write from another node, it merges the vector clocks by taking the maximum counter for each entry. Two vector clocks V1 and V2 have a clear ordering if every counter in V1 is less than or equal to the corresponding counter in V2 (meaning V1 happened before V2). If neither dominates the other, the writes are concurrent and a conflict exists.

```
Vector Clock Example:

Client 1 writes to Node A:    VC = {A:1}
Client 2 writes to Node B:    VC = {B:1}

These are concurrent: {A:1} and {B:1} are incomparable.

Read repair detects the conflict and returns BOTH versions
to the application for resolution.

If Client 3 now reads both, resolves, and writes via Node A:
  VC = {A:2, B:1}   (merges both, increments A)

This new version dominates both previous versions.
```

The Dynamo paper used vector clocks and pushed conflict resolution to the application. The shopping cart use case was ideal: merging two concurrent cart updates means taking the union of items, which is always safe. However, vector clocks have a practical problem: they grow unboundedly as more nodes write to the same key. Dynamo addressed this with clock truncation (dropping the oldest entry when the clock exceeds a threshold), but this can reintroduce false conflicts.

**CRDTs (Conflict-free Replicated Data Types)**

CRDTs are data structures that are mathematically guaranteed to converge when replicas merge their states, regardless of the order of operations. Examples include:

- **G-Counter (grow-only counter)**: Each node maintains its own counter; the total is the sum. Merging takes the max per node.
- **PN-Counter (positive-negative counter)**: Two G-Counters — one for increments, one for decrements.
- **OR-Set (observed-remove set)**: Each element is tagged with a unique ID; adding adds a new tag, removing removes all known tags. Concurrent add and remove of the same element results in the element being present (add wins).

CRDTs eliminate the need for conflict resolution at the cost of restricting the operations you can perform. Riak uses CRDTs extensively. For a key-value store, CRDTs are most useful when the values have specific structure (counters, sets, registers) rather than being opaque blobs.

**Read Repair and Write Repair**

Read repair occurs during read operations: when the coordinator receives different values from different replicas (detected by version comparison), it sends the latest value back to the stale replicas in the background. This is a lazy consistency mechanism — it only heals divergence for keys that are actually read.

Write repair (or active anti-entropy) is the proactive counterpart: the system periodically scans replicas for divergence using Merkle trees and pushes missing or outdated data. Together, read repair and write repair ensure that the system converges even without explicit conflict resolution by the application.

---

### Section 7 — Consistency and Availability

The CAP theorem states that a distributed system cannot simultaneously provide Consistency, Availability, and Partition tolerance — and since network partitions are unavoidable in any distributed system, you must choose between C and A during a partition. This section explores how key-value stores navigate this trade-off and offer tunable consistency to callers.

**CAP Theorem Implications**

When a network partition occurs, the system must make a choice. An AP system (like Dynamo, Cassandra, Riak) continues to accept reads and writes on both sides of the partition, at the cost of potentially serving stale data or accepting conflicting writes. A CP system (like etcd, ZooKeeper, HBase) refuses to serve requests that cannot be confirmed by a majority of nodes, preserving consistency at the cost of availability.

Most key-value stores choose AP because their primary use cases (caching, session storage, user profiles, time-series data) can tolerate brief periods of inconsistency. However, the choice is not binary — tunable consistency lets individual requests choose their own position on the spectrum.

**Tunable Consistency**

In Cassandra's model, the client specifies a consistency level for each request:

- **ONE**: Only one replica must respond. Fastest, but weakest consistency. Useful for time-series data where a single stale reading is acceptable.
- **QUORUM**: A majority of replicas (floor(N/2) + 1) must respond. Balances consistency and performance. With N=3, QUORUM means 2 replicas.
- **ALL**: All replicas must respond. Strongest consistency, but a single failed replica blocks the entire operation. Rarely used in production.
- **LOCAL_QUORUM**: Quorum within the local datacenter. Critical for multi-DC deployments where cross-DC latency would destroy p99 latency.
- **EACH_QUORUM**: Quorum in every datacenter. Strong multi-DC consistency at the cost of cross-DC latency on every request.

The relationship R + W > N guarantees that a read will see the latest write when using quorum reads and quorum writes. With N=3, R=2, W=2, this condition is satisfied (2 + 2 > 3), providing strong consistency within a single failure domain.

**Eventual Consistency Guarantees**

When using R=1 and W=1, the system provides only eventual consistency. But "eventual" is not "never" — in practice, replicas converge within milliseconds to seconds. The specific guarantees depend on the anti-entropy mechanisms:

- Read repair ensures convergence for frequently-accessed keys within one read cycle.
- Hinted handoff ensures writes reach their intended replicas within seconds of recovery.
- Merkle tree anti-entropy ensures full convergence within the scan period (typically minutes).

For many applications, this is more than sufficient. A user who updates their profile and sees the old version for 200ms is unlikely to notice or care.

**Linearizability When Needed**

Some operations demand linearizability — the guarantee that once a write is acknowledged, all subsequent reads see it. This is essential for distributed locks, leader election, and coordination. Key-value stores that support linearizability typically use a consensus protocol like Raft or Paxos for a subset of keys. etcd, for example, uses Raft to replicate every write to a majority of nodes before acknowledging it, guaranteeing linearizable reads and writes at the cost of higher latency.

DynamoDB offers "strongly consistent reads" which route the read to the leader replica of the partition, bypassing the quorum mechanism. This provides linearizability for individual keys but not across keys (no multi-key transactions).

**How Cassandra and DynamoDB Handle This**

Cassandra uses a leaderless replication model where any node can accept reads and writes for any key. Consistency is tunable per request via the consistency levels described above. Conflict resolution uses LWW with client-supplied timestamps. Cassandra does not offer linearizability for general operations, though lightweight transactions (using Paxos) provide compare-and-swap semantics for individual partitions.

DynamoDB uses a leader-based replication model within each partition. Writes go to the leader, which replicates synchronously to one other replica before acknowledging (providing durability). The leader then replicates asynchronously to the third replica. Reads can be either eventually consistent (routed to any replica) or strongly consistent (routed to the leader). DynamoDB supports transactions across multiple items and tables, implemented via a two-phase commit protocol internally.

---

### Section 8 — Failure Handling

Distributed systems fail. Disks corrupt, networks partition, entire datacenters go dark. The key-value store must handle all of these gracefully, and the interview expects you to articulate the mechanisms for detecting, tolerating, and recovering from each type of failure.

**Failure Detection: Gossip Protocol**

In a leaderless system, there is no central authority that declares a node dead. Instead, nodes use a gossip protocol to share membership and health information. Each node periodically selects a random peer and exchanges its membership list — a table of (node_id, heartbeat_counter, timestamp) entries. If a node's heartbeat counter has not increased for a configurable period (e.g., 30 seconds), it is marked as suspected, and if it remains unreachable for a longer period (e.g., 2 minutes), it is marked as dead.

The naive approach (fixed timeout) leads to false positives in networks with variable latency. The phi accrual failure detector, used by Cassandra and Akka, improves on this by maintaining a sliding window of inter-arrival times for heartbeats from each peer. It computes a "phi" value that represents the probability that the node has failed given the observed heartbeat interval distribution. When phi exceeds a configured threshold (typically 8, corresponding to roughly 1 in 10,000 chance of false positive), the node is suspected. This adaptive approach handles networks with different latency characteristics without manual tuning.

**Temporary Failures: Sloppy Quorum and Hinted Handoff**

When a designated replica is temporarily unreachable, the coordinator selects the next healthy node on the hash ring as a temporary stand-in. This node accepts the write and stores it with a hint — metadata indicating the intended recipient. When the coordinator detects that the original node has recovered (via the gossip protocol), it triggers the hinted handoff: the stand-in node sends the stored write to the recovered node and deletes the local copy.

The hint is stored with a TTL (typically 1-3 hours). If the intended node does not recover within this window, the hint is discarded and anti-entropy mechanisms must handle the inconsistency later. This TTL prevents the temporary node from accumulating unbounded hinted data from a permanently failed node.

**Permanent Failures: Anti-Entropy and Merkle Trees**

When a node fails permanently (disk failure, hardware retirement), the system must create new replicas to restore the replication factor. The steps are:

1. The gossip protocol detects the failure and propagates the node's "dead" status to all nodes.
2. The ring is updated: the dead node's virtual nodes are reassigned to other physical nodes.
3. For each key range that lost a replica, the system identifies the remaining replicas and a new target node.
4. Merkle tree comparison between the remaining replicas and the new target node determines exactly which data needs to be transferred.
5. The data is streamed from an existing replica to the new target, chunk by chunk, with checksum verification.

This process is called "repair" or "rebuild" and can take hours for large datasets. During the rebuild, the system operates with a reduced replication factor for the affected key ranges, which is why many production systems use a replication factor of 3 rather than 2 — losing one replica still leaves two copies, providing continued fault tolerance during the repair.

**Data Center Outages: Multi-DC Replication**

For surviving datacenter-level failures, the key-value store replicates data across geographically distributed datacenters. The replication strategies are:

- **Synchronous multi-DC**: Every write is replicated to all DCs before acknowledgment. Provides strong consistency across DCs but adds cross-DC latency (50-200ms) to every write. Used by etcd-based systems when correctness is critical.
- **Asynchronous multi-DC**: Writes are acknowledged locally and replicated to remote DCs asynchronously. Local latency is unaffected but there is a replication lag window during which a DC failure would lose recent writes. This is the common choice for most key-value stores.
- **Semi-synchronous**: Write to a quorum that includes at least one node in a remote DC. Balances durability and latency. DynamoDB's global tables use a variation of this approach.

In the consistent hashing model, the ring is configured to ensure that the N replicas for each key span multiple datacenters. A "rack-aware" or "DC-aware" placement strategy ensures that no two replicas of the same key are in the same failure domain.

---

### Section 9 — Trade-Offs and Design Decisions

Every design decision in a distributed key-value store is a trade-off. In an interview, articulating these trade-offs clearly — not just the decision, but the consequences and the alternatives — is what distinguishes a senior engineer from someone who has memorized a design.

**Consistency vs Availability**

This is the foundational trade-off, codified by the CAP theorem. An AP design (Dynamo, Cassandra) prioritizes availability and accepts temporary inconsistency; a CP design (etcd, ZooKeeper) prioritizes consistency and accepts temporary unavailability. The right choice depends on the use case. A shopping cart must always be available (losing a sale is worse than a stale read). A distributed lock must always be consistent (two holders of the same lock causes data corruption). Many systems sidestep the binary choice by offering tunable consistency, letting each request choose its own trade-off.

**LSM-Tree vs B-Tree**

As discussed in Section 4, LSM-trees favor writes (sequential I/O, higher throughput) at the cost of read amplification and write amplification from compaction. B-trees favor reads (direct page lookup) at the cost of random write I/O. For a general-purpose key-value store, the LSM-tree is typically the better choice because write performance is the bottleneck in most distributed systems (replication multiplies writes). However, if the workload is read-dominated (90%+ reads) and latency-sensitive, a B-tree engine like BoltDB or LMDB may be more appropriate.

**In-Memory vs On-Disk**

An in-memory key-value store (Redis, Memcached) offers sub-millisecond latency but is limited by RAM capacity and loses data on restart (unless persistence is configured). An on-disk store (RocksDB, Cassandra) scales to much larger datasets but has higher latency (especially for cache-miss reads). The hybrid approach — hot data in memory, warm data on SSD, cold data on HDD — is increasingly common. RocksDB's block cache, Linux page cache, and tiered storage all contribute to this hybrid model.

**Strong vs Eventual Consistency**

Strong consistency (linearizability) requires coordination between replicas on every request, adding latency and reducing availability. Eventual consistency eliminates coordination overhead but requires the application to handle stale reads and conflicting writes. The decision depends on correctness requirements: financial transactions need strong consistency; social media feeds do not. Many applications can use a mix: strong consistency for account balances, eventual consistency for activity feeds, all within the same system using tunable consistency levels.

**Simple Partitioning vs Consistent Hashing**

Range partitioning (keys a-m on node 1, n-z on node 2) is simple and supports efficient range queries but is prone to hot spots (if keys are not uniformly distributed). Hash partitioning (node = hash(key) % N) distributes evenly but destroys key ordering and requires massive data movement when N changes. Consistent hashing with virtual nodes is the standard choice for key-value stores because it handles node additions and removals gracefully while distributing data evenly. The trade-off is implementation complexity and the loss of efficient range queries (unless you use a hash of the partition key combined with range ordering within each partition, as Cassandra does).

**Synchronous vs Asynchronous Replication**

Synchronous replication (wait for all/quorum replicas before acknowledging) provides stronger durability and consistency but adds latency equal to the slowest replica. Asynchronous replication (acknowledge after local write, replicate in background) provides lower latency but creates a window where data exists on only one replica — if that node fails before replication completes, the data is lost. The quorum approach (wait for W of N replicas) is the middle ground that most systems adopt, letting the caller choose W based on their durability requirements.

---

### Section 10 — Interview Questions

**Beginner Tier**

*Question 1: What is the difference between a key-value store and a relational database? When would you choose one over the other?*

A relational database organizes data into tables with schemas, supports SQL queries with joins, and enforces ACID transactions. A key-value store maps keys to opaque values, supports only point lookups and writes (no joins, no ad-hoc queries), and typically relaxes consistency guarantees. You would choose a key-value store when your access pattern is simple (lookup by ID), you need extremely high throughput and low latency, and you do not need complex queries. Session storage, caching, user preferences, and shopping carts are ideal use cases. You would choose a relational database when you need complex queries, joins, transactions across multiple entities, or a flexible schema that can be queried in ways not anticipated at design time.

*Question 2: Explain the purpose of a write-ahead log (WAL) in a key-value store.*

The WAL is a durability mechanism. When a write arrives, it is first appended to the WAL on disk before being applied to the in-memory data structure (memtable). If the process crashes before the memtable is flushed to disk, the WAL is replayed on startup to reconstruct the memtable. Without a WAL, any data in the memtable that was not yet flushed would be permanently lost. The WAL is append-only, which makes writes sequential and fast. Once the memtable has been successfully flushed to an SSTable on disk, the corresponding WAL entries can be discarded because the data is now durably stored in the SSTable. In practice, WAL segments are rotated and older segments are deleted after their corresponding memtable flush completes.

*Question 3: What is consistent hashing and why is it used in distributed key-value stores?*

Consistent hashing maps both keys and nodes to positions on a circular hash space (ring). Each key is assigned to the first node encountered clockwise from the key's position. The critical advantage over modular hashing (node = hash(key) % N) is what happens when nodes are added or removed. With modular hashing, changing N redistributes nearly every key. With consistent hashing, only the keys in the affected segment of the ring are moved — roughly 1/N of the total data. Virtual nodes improve the distribution further by giving each physical node multiple positions on the ring, ensuring even load distribution and smooth rebalancing during cluster changes.

**Mid-Level Tier**

*Question 1: Compare LSM-tree and B-tree storage engines. Which would you use for a write-heavy key-value store, and why?*

LSM-trees buffer writes in an in-memory memtable and periodically flush sorted runs to disk as SSTables. This converts random writes into sequential writes, achieving much higher write throughput (10x-100x on HDDs, 3x-10x on SSDs). The cost is read amplification: a point lookup might need to check the memtable plus multiple SSTable levels. Bloom filters mitigate this but do not eliminate it. B-trees perform in-place updates on fixed-size pages, providing excellent read performance (typically 1-2 disk I/Os for a point lookup) but suffering from random write I/O.

For a write-heavy key-value store (30%+ writes), the LSM-tree is the clear winner. The write throughput advantage compounds in a distributed system because replication multiplies every write. However, the engineer must be aware of write amplification from compaction, which can be 10-30x in leveled compaction schemes. SSD endurance is a real concern at scale. Additionally, compaction can cause latency spikes if not properly managed (e.g., with rate limiting, as RocksDB provides).

*Question 2: Explain the quorum mechanism (N, W, R) and how it provides tunable consistency.*

In a replicated key-value store, N is the replication factor (number of copies), W is the write quorum (number of replicas that must acknowledge a write), and R is the read quorum (number of replicas that must respond to a read). The key insight is that if R + W > N, at least one node that participated in the latest write will participate in any subsequent read, ensuring the read sees the latest data.

With N=3, setting R=2, W=2 gives strong consistency (2+2=4 > 3) while tolerating one node failure for both reads and writes. Setting R=1, W=1 provides maximum speed and availability but only eventual consistency (1+1=2 <= 3). The beauty of this model is that each client request can choose its own consistency level. A user profile read might use R=1 for speed, while a payment confirmation read might use R=2 for correctness. The trade-off is always the same: higher R or W means stronger consistency but higher latency and lower availability.

*Question 3: How does a Bloom filter improve read performance in an LSM-tree, and what are its limitations?*

In an LSM-tree, a read must potentially check multiple SSTables to find a key. Without optimization, this means multiple disk I/Os. A Bloom filter is a space-efficient probabilistic data structure that can tell you with certainty that a key is NOT in an SSTable (no false negatives) or that it MIGHT be in the SSTable (possible false positives). By checking the Bloom filter before reading from disk, the system avoids the vast majority of unnecessary disk reads.

With 10 bits per key, the false positive rate is about 1%. For a node with 50 million keys across 100 SSTables, a point lookup will check 100 Bloom filters (all in memory, very fast) and perform a disk read on average only 1 unnecessary SSTable (100 * 0.01 = 1). The memory cost is 50 million * 10 bits = 62.5 MB — a small fraction of available RAM.

Limitations: Bloom filters do not help with range queries (they answer "is this exact key present?", not "are any keys in this range present?"). They cannot be updated — when an SSTable is compacted, a new Bloom filter must be built for the output SSTable. And the false positive rate, while low, means occasional unnecessary disk reads. Some systems (like RocksDB) use prefix Bloom filters for range scans and partitioned Bloom filters for better cache locality.

**Senior Tier**

*Question 1: Design the conflict resolution strategy for a key-value store that must handle concurrent writes across datacenters. Discuss at least three approaches and their trade-offs.*

The three primary approaches are Last-Write-Wins (LWW), vector clocks, and CRDTs, each with distinct trade-offs.

LWW assigns a timestamp to each write and resolves conflicts by keeping the highest timestamp. It is simple, requires no metadata beyond the timestamp, and always produces a single deterministic winner. The weakness is silent data loss: concurrent writes to the same key result in one being permanently discarded. Clock skew can cause causally later writes to be discarded in favor of causally earlier ones. HLC (hybrid logical clocks) mitigate clock skew but do not solve the fundamental data loss problem. LWW is appropriate when data loss from concurrent writes is acceptable (e.g., sensor readings, analytics events, user profile updates where the last state is always correct).

Vector clocks track causal relationships between writes. Each replica maintains a counter, and the vector clock for a key is the set of all replica counters. Two versions with incomparable vector clocks represent a genuine conflict that must be resolved by the application or the user. This preserves all conflicting versions but adds metadata overhead (the vector clock grows with the number of replicas that have written to the key) and pushes conflict resolution complexity to the application layer. Vector clocks are appropriate when data loss is unacceptable and the application has domain-specific merge logic (e.g., shopping carts: merge = union of items).

CRDTs are data structures designed to converge automatically regardless of the order of operations. A CRDT-based register (LWW-Register or MV-Register), counter (G-Counter, PN-Counter), or set (OR-Set) can be merged by any replica without coordination. The trade-off is that CRDTs constrain the operations you can perform — you cannot implement arbitrary application logic. They also consume more space than LWW (metadata for each operation). CRDTs are appropriate when the value has structure that can be expressed as a CRDT (counters, sets, flags) and automatic merging is worth the operational complexity.

In practice, I would implement a hybrid approach: LWW as the default for opaque blobs, with optional vector clock tracking for keys where the application opts in, and CRDT support for well-known data types (counters, sets). This mirrors DynamoDB's approach (LWW default) and Riak's (CRDTs for structured types, vector clocks for everything else).

*Question 2: How would you handle a rolling upgrade of the storage engine format in a production key-value store with zero downtime?*

Rolling upgrades in a distributed key-value store require careful orchestration to maintain availability and data integrity. The approach involves four phases:

First, deploy the new code that can read both the old and new storage formats. This is the compatibility phase. Every node is upgraded to this dual-reader version before any data format changes begin. This ensures that during the rolling restart, nodes running the new code can still read data written by nodes running the old code, and vice versa.

Second, begin the gradual conversion. When compaction runs on a node, the output SSTables are written in the new format. This means the migration happens organically as a byproduct of normal compaction, without adding load. A metadata flag in each SSTable header indicates its format version. New SSTables are written in the new format; old SSTables are read using the old format's reader. This phase can take days or weeks depending on the compaction cycle.

Third, monitor the percentage of data in the new format across all nodes. When 100% of SSTables on a node are in the new format, that node no longer needs the old format reader.

Fourth, after all nodes have completed conversion, deploy a final code version that removes the old format reader. This simplifies the codebase and reduces the testing surface.

Throughout this process, the quorum mechanism ensures availability: at any point, if a node is being restarted for the upgrade, the remaining replicas serve requests. The key invariant is that no write quorum is ever violated during the upgrade — you restart nodes one at a time, waiting for each to rejoin the ring and catch up via anti-entropy before proceeding to the next.

*Question 3: Your key-value store is experiencing tail latency spikes at p99. Walk through your debugging and mitigation strategy.*

Tail latency spikes (p99 > 10ms when p50 is < 1ms) in a key-value store typically originate from one of several causes, and the debugging strategy must systematically rule each one out.

First, check compaction. LSM-tree compaction is the most common cause of latency spikes because it competes with foreground reads and writes for disk I/O. Examine compaction metrics: pending bytes, compaction throughput, and correlation with latency spikes. Mitigation: configure RocksDB's rate limiter to cap compaction I/O (e.g., 200 MB/sec), use direct I/O for compaction to avoid polluting the page cache, and switch from leveled to universal compaction if write amplification is the bottleneck.

Second, check garbage collection (if using a JVM-based system like Cassandra). GC pauses directly translate to latency spikes. Examine GC logs for stop-the-world pauses. Mitigation: tune heap size, switch to a low-pause collector (ZGC or Shenandoah), reduce object allocation by using off-heap memory for the memtable and block cache.

Third, check the network. One slow node in the quorum path inflates the overall request latency. Examine per-node latency distributions to identify outliers. Mitigation: hedged requests (send the read to all N replicas and return the first response), speculative retry (if the primary does not respond within the p50 latency, send a speculative request to another replica), or blacklisting nodes with consistently high latency until they recover.

Fourth, check the operating system. Page faults (if the working set exceeds memory), disk I/O saturation (check iowait and disk queue depth), and network buffer exhaustion can all cause tail latency. Mitigation: ensure sufficient memory for bloom filters, memtables, and a generous block cache; use NVMe SSDs with high IOPS; tune kernel parameters (readahead, I/O scheduler, TCP buffer sizes).

Fifth, check for hot keys. A small number of keys receiving a disproportionate number of requests can overwhelm a single partition. Mitigation: client-side caching for frequently-read hot keys, key splitting (fan-out the hot key across multiple partitions with a random suffix), or a dedicated in-memory cache tier in front of the key-value store.

---

### Section 11 — Complete Code Example

This section provides two implementations: first, distributed pseudocode showing the overall system architecture, and second, a working Node.js implementation of a single-node key-value store with an LSM-tree storage engine.

**Distributed Key-Value Store Pseudocode**

```
// ============================================================
// Distributed Key-Value Store — Pseudocode
// ============================================================

// --- Data Structures ---

structure KeyValuePair:
    key:       bytes
    value:     bytes
    timestamp: int64        // hybrid logical clock
    tombstone: boolean      // true if this is a delete marker
    ttl:       int64        // 0 means no expiration

structure VirtualNode:
    position:  int128       // position on hash ring
    physical:  NodeAddress  // owning physical node

structure RingTopology:
    sorted_vnodes: SortedList<VirtualNode>  // sorted by position
    replication_factor: int                 // N, typically 3

// --- Hash Ring Operations ---

function get_responsible_nodes(ring, key):
    // Hash the key to find its position on the ring.
    position = hash_128(key)

    // Walk clockwise to find N distinct physical nodes.
    responsible = []
    seen_physical = set()
    index = binary_search(ring.sorted_vnodes, position)

    while len(responsible) < ring.replication_factor:
        vnode = ring.sorted_vnodes[index % len(ring.sorted_vnodes)]
        if vnode.physical not in seen_physical:
            responsible.append(vnode.physical)
            seen_physical.add(vnode.physical)
        index = index + 1

    return responsible

// --- Write Path ---

function put(key, value, consistency_level):
    // Step 1: Determine responsible replicas from the hash ring.
    replicas = get_responsible_nodes(ring, key)

    // Step 2: Create the key-value pair with a timestamp.
    pair = KeyValuePair(key, value, hlc.now(), false, 0)

    // Step 3: Send write to all replicas in parallel.
    futures = []
    for replica in replicas:
        futures.append(async_send_write(replica, pair))

    // Step 4: Wait for W acknowledgments (write quorum).
    W = quorum_size(consistency_level, ring.replication_factor)
    acks = wait_for_n(futures, W, timeout=100ms)

    // Step 5: If fewer than W acks, attempt sloppy quorum.
    if len(acks) < W:
        // Find next healthy nodes on the ring (hinted handoff).
        hint_targets = get_hint_targets(ring, replicas)
        for target in hint_targets:
            hint = HintedWrite(pair, intended=failed_replica)
            async_send_hint(target, hint)

    // Step 6: Return success/failure based on ack count.
    if len(acks) >= W:
        return SUCCESS
    else:
        return FAILURE

// --- Read Path ---

function get(key, consistency_level):
    // Step 1: Determine responsible replicas.
    replicas = get_responsible_nodes(ring, key)

    // Step 2: Send read to all replicas in parallel.
    futures = []
    for replica in replicas:
        futures.append(async_send_read(replica, key))

    // Step 3: Wait for R responses (read quorum).
    R = quorum_size(consistency_level, ring.replication_factor)
    responses = wait_for_n(futures, R, timeout=100ms)

    // Step 4: Select the value with the highest timestamp.
    best = max(responses, key=lambda r: r.timestamp)

    // Step 5: If responses disagree, trigger read repair.
    if not all_same(responses):
        trigger_read_repair(replicas, best)

    // Step 6: Check TTL expiration.
    if best.ttl > 0 and current_time() > best.timestamp + best.ttl:
        return NOT_FOUND

    // Step 7: Check for tombstone (deleted key).
    if best.tombstone:
        return NOT_FOUND

    return best.value

// --- Node-Local Write (on each replica) ---

function local_put(pair):
    // Step 1: Append to WAL for durability.
    wal.append(serialize(pair))

    // Step 2: Insert into memtable.
    memtable.insert(pair.key, pair)

    // Step 3: If memtable exceeds size threshold, flush.
    if memtable.size() > MEMTABLE_THRESHOLD:
        frozen = memtable
        memtable = new Memtable()
        background_flush(frozen)

// --- Node-Local Read (on each replica) ---

function local_get(key):
    // Step 1: Check active memtable.
    result = memtable.get(key)
    if result != null:
        return result

    // Step 2: Check immutable (flushing) memtable.
    if immutable_memtable != null:
        result = immutable_memtable.get(key)
        if result != null:
            return result

    // Step 3: Check SSTables from newest to oldest.
    for sstable in sstables_newest_first():
        // Check bloom filter first.
        if not sstable.bloom_filter.might_contain(key):
            continue  // Definitely not in this SSTable.
        // Binary search the SSTable index.
        result = sstable.search(key)
        if result != null:
            return result

    return NOT_FOUND
```

**Node.js Implementation: Single-Node LSM-Tree Key-Value Store**

```javascript
// ============================================================
// Single-Node Key-Value Store with LSM-Tree Storage Engine
// Node.js Implementation
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ----- Bloom Filter -----
// A space-efficient probabilistic data structure used to test
// whether a key is a member of a set. False positives are possible
// but false negatives are not. We use multiple hash functions
// (implemented via double hashing) to set bits in a bit array.

class BloomFilter {
    constructor(expectedItems, falsePositiveRate = 0.01) {
        // Calculate optimal size: m = -n*ln(p) / (ln(2))^2
        // where n = expected items, p = false positive rate.
        this.size = Math.ceil(
            (-expectedItems * Math.log(falsePositiveRate))
            / (Math.log(2) ** 2)
        );
        // Calculate optimal number of hash functions: k = (m/n) * ln(2)
        this.hashCount = Math.ceil(
            (this.size / expectedItems) * Math.log(2)
        );
        // Initialize the bit array as a Buffer of bytes.
        // Each byte holds 8 bits.
        this.bits = Buffer.alloc(Math.ceil(this.size / 8), 0);
    }

    // Generate two base hashes using MD5, then derive k hash
    // positions via double hashing: h(i) = h1 + i * h2.
    _hashes(key) {
        const hash = crypto.createHash('md5')
            .update(String(key)).digest();
        // Read two 32-bit integers from the hash digest.
        const h1 = hash.readUInt32LE(0);
        const h2 = hash.readUInt32LE(4);
        const positions = [];
        for (let i = 0; i < this.hashCount; i++) {
            // Modular arithmetic ensures position is within the bit array.
            positions.push(((h1 + i * h2) >>> 0) % this.size);
        }
        return positions;
    }

    // Add a key to the filter by setting its hash positions to 1.
    add(key) {
        for (const pos of this._hashes(key)) {
            const byteIndex = Math.floor(pos / 8);
            const bitIndex = pos % 8;
            // Set the specific bit using bitwise OR.
            this.bits[byteIndex] |= (1 << bitIndex);
        }
    }

    // Check if a key might exist. Returns false only if the key
    // is definitely absent (one or more bits are not set).
    mightContain(key) {
        for (const pos of this._hashes(key)) {
            const byteIndex = Math.floor(pos / 8);
            const bitIndex = pos % 8;
            // If any bit is not set, the key is definitely absent.
            if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
                return false;
            }
        }
        // All bits are set — the key might be present (possible false positive).
        return true;
    }

    // Serialize the bloom filter to a buffer for storage in an SSTable.
    serialize() {
        const header = Buffer.alloc(12);
        header.writeUInt32LE(this.size, 0);
        header.writeUInt32LE(this.hashCount, 4);
        header.writeUInt32LE(this.bits.length, 8);
        return Buffer.concat([header, this.bits]);
    }

    // Reconstruct a bloom filter from a serialized buffer.
    static deserialize(buffer) {
        const size = buffer.readUInt32LE(0);
        const hashCount = buffer.readUInt32LE(4);
        const bitsLen = buffer.readUInt32LE(8);
        const filter = new BloomFilter(1); // dummy constructor
        filter.size = size;
        filter.hashCount = hashCount;
        filter.bits = buffer.slice(12, 12 + bitsLen);
        return filter;
    }
}

// ----- Memtable (In-Memory Sorted Structure) -----
// We use a simple sorted array with binary search for this
// implementation. Production systems use skip lists or
// red-black trees for O(log n) concurrent access.

class Memtable {
    constructor(maxSize = 64 * 1024 * 1024) {
        // maxSize: flush threshold in bytes.
        this.entries = [];      // Sorted array of {key, value, timestamp, tombstone}
        this.currentSize = 0;   // Approximate byte count of all entries.
        this.maxSize = maxSize; // When currentSize exceeds this, trigger flush.
    }

    // Binary search for the insertion point of the given key.
    _findIndex(key) {
        let lo = 0, hi = this.entries.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.entries[mid].key < key) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // Insert or update a key-value pair. Maintains sorted order.
    put(key, value, timestamp, tombstone = false) {
        const entry = { key, value, timestamp, tombstone };
        const entrySize = key.length + (value ? value.length : 0) + 16;
        const idx = this._findIndex(key);

        if (idx < this.entries.length && this.entries[idx].key === key) {
            // Key exists: update in place. Adjust size for the old entry.
            const oldSize = this.entries[idx].key.length
                + (this.entries[idx].value ? this.entries[idx].value.length : 0) + 16;
            this.currentSize -= oldSize;
            this.entries[idx] = entry;
        } else {
            // Key does not exist: insert at the correct sorted position.
            this.entries.splice(idx, 0, entry);
        }
        this.currentSize += entrySize;
    }

    // Look up a key. Returns the entry if found, null otherwise.
    get(key) {
        const idx = this._findIndex(key);
        if (idx < this.entries.length && this.entries[idx].key === key) {
            return this.entries[idx];
        }
        return null;
    }

    // Check whether the memtable has exceeded its size threshold.
    isFull() {
        return this.currentSize >= this.maxSize;
    }

    // Return all entries (already sorted by key) for flushing.
    getAllEntries() {
        return this.entries;
    }
}

// ----- Write-Ahead Log (WAL) -----
// An append-only file that records every write before it is
// applied to the memtable. On crash recovery, the WAL is
// replayed to restore the memtable state.

class WriteAheadLog {
    constructor(directory) {
        this.directory = directory;
        // Ensure the WAL directory exists.
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }
        // Each WAL segment corresponds to one memtable generation.
        this.segmentId = Date.now();
        this.filePath = path.join(directory, `wal-${this.segmentId}.log`);
        // Open the file in append mode.
        this.fd = fs.openSync(this.filePath, 'a');
    }

    // Append a write operation to the WAL. Each entry is a
    // newline-delimited JSON record for simplicity. Production
    // systems use a binary format with CRC checksums.
    append(key, value, timestamp, tombstone = false) {
        const record = JSON.stringify({ key, value, timestamp, tombstone });
        fs.writeSync(this.fd, record + '\n');
        // In production, you would also call fsync here for true durability.
        // fs.fsyncSync(this.fd);
    }

    // Rotate the WAL: close the current segment and start a new one.
    // Called after the memtable is successfully flushed to an SSTable.
    rotate() {
        fs.closeSync(this.fd);
        this.segmentId = Date.now();
        this.filePath = path.join(this.directory, `wal-${this.segmentId}.log`);
        this.fd = fs.openSync(this.filePath, 'a');
    }

    // Delete a WAL segment after its corresponding SSTable is written.
    deleteSegment(segmentPath) {
        if (fs.existsSync(segmentPath)) {
            fs.unlinkSync(segmentPath);
        }
    }

    // Replay all WAL segments to recover memtable state after a crash.
    // Returns an array of entries in chronological order.
    static recover(directory) {
        const entries = [];
        if (!fs.existsSync(directory)) return entries;

        const files = fs.readdirSync(directory)
            .filter(f => f.startsWith('wal-') && f.endsWith('.log'))
            .sort(); // Sort by segment ID (timestamp) for correct ordering.

        for (const file of files) {
            const content = fs.readFileSync(
                path.join(directory, file), 'utf-8'
            );
            // Each line is a JSON record.
            for (const line of content.split('\n').filter(l => l.trim())) {
                try {
                    entries.push(JSON.parse(line));
                } catch (e) {
                    // Corrupted record — skip it. In production,
                    // CRC checksums would detect partial writes.
                    console.error(`Corrupted WAL record: ${line}`);
                }
            }
        }
        return entries;
    }

    // Close the WAL file descriptor.
    close() {
        fs.closeSync(this.fd);
    }
}

// ----- SSTable (Sorted String Table) -----
// An immutable, sorted file on disk containing key-value pairs.
// Each SSTable also contains an index for efficient lookups
// and a bloom filter for fast negative lookups.

class SSTable {
    constructor(filePath) {
        this.filePath = filePath;
        this.index = [];        // Sparse index: [{key, offset}]
        this.bloomFilter = null;
        this.minKey = null;     // Smallest key in this SSTable.
        this.maxKey = null;     // Largest key in this SSTable.
    }

    // Write a sorted array of entries to disk as an SSTable.
    // The file format is:
    //   [data section: newline-delimited JSON records]
    //   [index section: JSON array of {key, offset} pairs]
    //   [bloom filter: serialized binary]
    //   [footer: 4 bytes index offset, 4 bytes bloom offset]
    static write(filePath, entries) {
        const sstable = new SSTable(filePath);
        const bloom = new BloomFilter(Math.max(entries.length, 1));
        const index = [];
        let data = '';
        let offset = 0;

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            // Add every key to the bloom filter.
            bloom.add(entry.key);

            // Build a sparse index: one entry per 16 records.
            // This trades memory for binary search granularity.
            if (i % 16 === 0) {
                index.push({ key: entry.key, offset });
            }

            // Track the key range of this SSTable.
            if (i === 0) sstable.minKey = entry.key;
            if (i === entries.length - 1) sstable.maxKey = entry.key;

            // Serialize the entry as a JSON line.
            const line = JSON.stringify(entry) + '\n';
            data += line;
            offset += Buffer.byteLength(line);
        }

        // Serialize the index section.
        const indexStr = JSON.stringify(index) + '\n';
        const indexOffset = offset;

        // Serialize the bloom filter.
        const bloomBuf = bloom.serialize();
        const bloomOffset = indexOffset + Buffer.byteLength(indexStr);

        // Write the footer: two 4-byte integers pointing to
        // the index and bloom filter sections.
        const footer = Buffer.alloc(8);
        footer.writeUInt32LE(indexOffset, 0);
        footer.writeUInt32LE(bloomOffset, 4);

        // Write everything to disk in a single call.
        const fullData = Buffer.concat([
            Buffer.from(data),
            Buffer.from(indexStr),
            bloomBuf,
            footer,
        ]);
        fs.writeFileSync(filePath, fullData);

        sstable.index = index;
        sstable.bloomFilter = bloom;
        return sstable;
    }

    // Load an SSTable's index and bloom filter into memory.
    // The actual data remains on disk and is read on demand.
    static load(filePath) {
        const sstable = new SSTable(filePath);
        const fileData = fs.readFileSync(filePath);

        // Read the footer to find section offsets.
        const footerStart = fileData.length - 8;
        const indexOffset = fileData.readUInt32LE(footerStart);
        const bloomOffset = fileData.readUInt32LE(footerStart + 4);

        // Parse the index section.
        const indexStr = fileData.slice(indexOffset, bloomOffset).toString();
        sstable.index = JSON.parse(indexStr.trim());

        // Parse the bloom filter section.
        const bloomBuf = fileData.slice(bloomOffset, footerStart);
        sstable.bloomFilter = BloomFilter.deserialize(bloomBuf);

        // Set the key range from the index.
        if (sstable.index.length > 0) {
            sstable.minKey = sstable.index[0].key;
            sstable.maxKey = sstable.index[sstable.index.length - 1].key;
        }

        return sstable;
    }

    // Search for a key in this SSTable.
    // Returns the entry if found, null otherwise.
    search(key) {
        // Step 1: Check the bloom filter. If it says "no",
        // the key is definitely not here. Skip the disk read.
        if (!this.bloomFilter.mightContain(key)) {
            return null;
        }

        // Step 2: Binary search the sparse index to find the
        // data region where the key might exist.
        let lo = 0, hi = this.index.length - 1;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (this.index[mid].key <= key) lo = mid;
            else hi = mid - 1;
        }

        // Step 3: Read the data section from the identified offset.
        const startOffset = this.index[lo].offset;
        const endOffset = (lo + 1 < this.index.length)
            ? this.index[lo + 1].offset
            : fs.statSync(this.filePath).size;

        const fd = fs.openSync(this.filePath, 'r');
        const buf = Buffer.alloc(endOffset - startOffset);
        fs.readSync(fd, buf, 0, buf.length, startOffset);
        fs.closeSync(fd);

        // Step 4: Scan the block line by line to find the exact key.
        const lines = buf.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.key === key) return entry;
                // Since entries are sorted, if we pass the key,
                // it does not exist in this block.
                if (entry.key > key) return null;
            } catch (e) {
                continue; // Skip malformed lines.
            }
        }
        return null;
    }
}

// ----- Compaction Engine -----
// Merges multiple SSTables into a single SSTable, removing
// obsolete versions and tombstones. This is a simplified
// size-tiered compaction: when the number of SSTables exceeds
// a threshold, the oldest ones are merged.

class CompactionEngine {
    constructor(dataDir, maxSSTables = 4) {
        this.dataDir = dataDir;
        // When more than maxSSTables exist, trigger compaction.
        this.maxSSTables = maxSSTables;
    }

    // Determine if compaction is needed based on SSTable count.
    needsCompaction(sstables) {
        return sstables.length > this.maxSSTables;
    }

    // Merge multiple SSTables into one. Uses a k-way merge
    // on the sorted entries, keeping only the latest version
    // of each key and discarding expired tombstones.
    compact(sstables) {
        // Step 1: Read all entries from all SSTables.
        const allEntries = new Map();
        for (const sst of sstables) {
            const content = fs.readFileSync(sst.filePath);
            const footerStart = content.length - 8;
            const indexOffset = content.readUInt32LE(footerStart);
            const dataSection = content.slice(0, indexOffset).toString();

            for (const line of dataSection.split('\n').filter(l => l.trim())) {
                try {
                    const entry = JSON.parse(line);
                    const existing = allEntries.get(entry.key);
                    // Keep the entry with the highest timestamp.
                    if (!existing || entry.timestamp > existing.timestamp) {
                        allEntries.set(entry.key, entry);
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        // Step 2: Filter out tombstones that have expired.
        // In production, tombstones are kept for a grace period
        // (e.g., gc_grace_seconds in Cassandra) to ensure all
        // replicas learn about the deletion.
        const TOMBSTONE_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours
        const now = Date.now();
        const merged = [];
        for (const [key, entry] of allEntries) {
            if (entry.tombstone
                && (now - entry.timestamp) > TOMBSTONE_GRACE_MS) {
                continue; // Tombstone has expired; discard it.
            }
            merged.push(entry);
        }

        // Step 3: Sort by key for the output SSTable.
        merged.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

        // Step 4: Write the merged SSTable.
        const outputPath = path.join(
            this.dataDir, `sst-${Date.now()}-compacted.dat`
        );
        const newSSTable = SSTable.write(outputPath, merged);

        // Step 5: Delete the old SSTables.
        for (const sst of sstables) {
            if (fs.existsSync(sst.filePath)) {
                fs.unlinkSync(sst.filePath);
            }
        }

        return newSSTable;
    }
}

// ----- KVStore: The Main Key-Value Store -----
// Ties together all components: WAL, memtable, SSTables,
// bloom filters, and compaction into a cohesive storage engine.

class KVStore {
    constructor(dataDir = './kv-data') {
        this.dataDir = dataDir;
        this.walDir = path.join(dataDir, 'wal');
        this.sstDir = path.join(dataDir, 'sst');

        // Ensure data directories exist.
        if (!fs.existsSync(this.sstDir)) {
            fs.mkdirSync(this.sstDir, { recursive: true });
        }

        // Initialize the memtable (64 KB threshold for demo;
        // production uses 64 MB or more).
        this.memtable = new Memtable(64 * 1024);
        this.immutableMemtable = null; // Memtable being flushed.

        // Initialize the WAL.
        this.wal = new WriteAheadLog(this.walDir);

        // Load existing SSTables from disk (newest first).
        this.sstables = this._loadSSTables();

        // Initialize the compaction engine.
        this.compaction = new CompactionEngine(this.sstDir);

        // Recover any unflushed data from the WAL.
        this._recover();
    }

    // Load all SSTable files from the SSTable directory.
    // Sort by creation time descending (newest first) so that
    // reads check the most recent data first.
    _loadSSTables() {
        if (!fs.existsSync(this.sstDir)) return [];
        const files = fs.readdirSync(this.sstDir)
            .filter(f => f.endsWith('.dat'))
            .sort()
            .reverse(); // Newest first.
        return files.map(f => SSTable.load(path.join(this.sstDir, f)));
    }

    // Replay WAL entries into the memtable to recover from a crash.
    _recover() {
        const entries = WriteAheadLog.recover(this.walDir);
        for (const entry of entries) {
            this.memtable.put(
                entry.key, entry.value,
                entry.timestamp, entry.tombstone
            );
        }
        if (entries.length > 0) {
            console.log(`Recovered ${entries.length} entries from WAL.`);
        }
    }

    // Write a key-value pair to the store.
    put(key, value) {
        const timestamp = Date.now();

        // Step 1: Append to WAL for durability.
        this.wal.append(key, value, timestamp, false);

        // Step 2: Insert into the active memtable.
        this.memtable.put(key, value, timestamp, false);

        // Step 3: If memtable is full, flush it to an SSTable.
        if (this.memtable.isFull()) {
            this._flushMemtable();
        }
    }

    // Retrieve the value for a key from the store.
    get(key) {
        // Step 1: Check the active memtable (most recent writes).
        let entry = this.memtable.get(key);
        if (entry) {
            // Found in memtable. Check if it is a tombstone (delete).
            if (entry.tombstone) return null;
            return entry.value;
        }

        // Step 2: Check the immutable memtable (being flushed).
        if (this.immutableMemtable) {
            entry = this.immutableMemtable.get(key);
            if (entry) {
                if (entry.tombstone) return null;
                return entry.value;
            }
        }

        // Step 3: Check SSTables from newest to oldest.
        // The bloom filter check avoids unnecessary disk reads.
        for (const sstable of this.sstables) {
            entry = sstable.search(key);
            if (entry) {
                if (entry.tombstone) return null;
                return entry.value;
            }
        }

        // Key not found anywhere.
        return null;
    }

    // Delete a key by writing a tombstone marker.
    // The actual data is removed during compaction.
    delete(key) {
        const timestamp = Date.now();

        // Write a tombstone to WAL and memtable.
        this.wal.append(key, null, timestamp, true);
        this.memtable.put(key, null, timestamp, true);

        if (this.memtable.isFull()) {
            this._flushMemtable();
        }
    }

    // Flush the current memtable to an SSTable on disk.
    _flushMemtable() {
        // Freeze the current memtable and create a new one.
        this.immutableMemtable = this.memtable;
        this.memtable = new Memtable(64 * 1024);

        // Get all entries from the frozen memtable (already sorted).
        const entries = this.immutableMemtable.getAllEntries();

        if (entries.length === 0) {
            this.immutableMemtable = null;
            return;
        }

        // Write the entries to a new SSTable file.
        const sstPath = path.join(this.sstDir, `sst-${Date.now()}.dat`);
        const sstable = SSTable.write(sstPath, entries);

        // Add the new SSTable to the front of the list (newest first).
        this.sstables.unshift(sstable);

        // Rotate the WAL since the memtable data is now on disk.
        const oldWalPath = this.wal.filePath;
        this.wal.rotate();
        this.wal.deleteSegment(oldWalPath);

        // Clear the immutable memtable reference.
        this.immutableMemtable = null;

        // Check if compaction is needed.
        if (this.compaction.needsCompaction(this.sstables)) {
            this._runCompaction();
        }
    }

    // Run compaction on the oldest SSTables.
    _runCompaction() {
        // In this simplified version, we compact all SSTables.
        // Production systems are more selective (e.g., pick SSTables
        // of similar size, or compact one level at a time).
        console.log(
            `Compacting ${this.sstables.length} SSTables...`
        );
        const newSSTable = this.compaction.compact(this.sstables);
        this.sstables = [newSSTable];
        console.log('Compaction complete.');
    }

    // Gracefully shut down the store: flush memtable and close WAL.
    close() {
        if (this.memtable.getAllEntries().length > 0) {
            this._flushMemtable();
        }
        this.wal.close();
    }
}

// ----- Usage Example -----

function main() {
    const store = new KVStore('./demo-kv-data');

    // Write some key-value pairs.
    console.log('Writing data...');
    store.put('user:1001', JSON.stringify({ name: 'Alice', age: 30 }));
    store.put('user:1002', JSON.stringify({ name: 'Bob', age: 25 }));
    store.put('user:1003', JSON.stringify({ name: 'Charlie', age: 35 }));

    // Read them back.
    console.log('Reading data...');
    console.log('user:1001 =>', store.get('user:1001'));
    console.log('user:1002 =>', store.get('user:1002'));
    console.log('user:1003 =>', store.get('user:1003'));

    // Update a value.
    store.put('user:1001', JSON.stringify({ name: 'Alice', age: 31 }));
    console.log('After update, user:1001 =>', store.get('user:1001'));

    // Delete a key.
    store.delete('user:1002');
    console.log('After delete, user:1002 =>', store.get('user:1002'));

    // Write enough data to trigger a memtable flush.
    console.log('Writing bulk data to trigger flush...');
    for (let i = 0; i < 1000; i++) {
        store.put(
            `bulk:${String(i).padStart(6, '0')}`,
            'x'.repeat(100)
        );
    }

    // Verify data survives flush.
    console.log('After flush, user:1001 =>', store.get('user:1001'));
    console.log('After flush, bulk:000500 =>', store.get('bulk:000500'));
    console.log(
        'After flush, user:1002 (deleted) =>', store.get('user:1002')
    );

    // Clean shutdown.
    store.close();
    console.log('Store closed.');
}

main();
```

**Line-by-Line Explanation of Key Sections**

The `BloomFilter` class implements the probabilistic data structure using double hashing. The constructor calculates the optimal bit array size and hash count from the expected item count and desired false positive rate. The `_hashes` method generates multiple hash positions from a single MD5 digest using the formula h(i) = h1 + i * h2, which is mathematically equivalent to using independent hash functions. The `add` method sets bits at each hash position, and `mightContain` checks them — returning false only when a bit is definitively unset.

The `Memtable` class maintains a sorted array of entries with binary search for both lookups and insertions. The `put` method finds the correct insertion point using binary search, either updating an existing entry or splicing a new one into the sorted position. The `currentSize` tracker approximates memory usage so we know when to trigger a flush. In production, a concurrent skip list would replace this sorted array to allow lock-free reads during concurrent writes.

The `WriteAheadLog` class wraps a simple append-only file. Each write is serialized as a JSON line and appended synchronously. The `rotate` method closes the current segment and opens a new one, allowing the old segment to be deleted after its data is flushed to an SSTable. The static `recover` method reads all WAL segments in order and returns the entries for memtable reconstruction.

The `SSTable` class handles the on-disk sorted file format. The static `write` method creates the file with four sections: the data (sorted JSON lines), the sparse index (one entry per 16 records for memory efficiency), the serialized bloom filter, and an 8-byte footer containing the offsets of the index and bloom filter sections. The `search` method first checks the bloom filter, then binary searches the sparse index to find the relevant data block, reads only that block from disk, and scans it for the exact key.

The `KVStore` class orchestrates all components. The `put` method follows the LSM-tree write path: WAL append, then memtable insert, then conditional flush. The `get` method follows the read path: memtable, immutable memtable, then SSTables from newest to oldest. The `delete` method writes a tombstone rather than actually removing data. The `_flushMemtable` method freezes the current memtable, writes it as an SSTable, rotates the WAL, and triggers compaction if needed.

---

### Section 12 — Connection to Next Topic

You have just designed a persistent, distributed key-value store — a system that durably stores data on disk, replicates it across nodes for fault tolerance, and scales horizontally to handle petabytes of data and hundreds of thousands of operations per second. This is the foundation that underpins databases, message queues, and configuration stores.

But there is a specialized variant of the key-value store that trades durability for speed: the distributed cache. In Topic 44, we will design a distributed cache — a system like Memcached or Redis that keeps all data in memory for sub-millisecond access. The fundamental data structure is still a hash map from keys to values, but the design priorities shift dramatically. Durability is optional (data can be recomputed or re-fetched). Eviction policies (LRU, LFU, TTL) replace compaction as the primary space management mechanism. The write path eliminates WAL and SSTable overhead in favor of direct memory writes. And the failure model changes: when a cache node dies, the data is simply gone, and the system must handle the resulting "thundering herd" of cache misses gracefully.

The connection between these two topics is direct and intentional. A distributed cache is a key-value store where the storage engine is a hash table in RAM, the replication strategy may be absent entirely (Memcached) or configurable (Redis Cluster), and the consistency model is deliberately relaxed because stale cache data is acceptable in exchange for the performance benefit. Understanding the full persistent key-value store design from this topic gives you the vocabulary and conceptual framework to reason about caches as a constrained special case — and to explain clearly in an interview why you would choose one over the other, or layer a cache in front of a persistent store for the best of both worlds.

---

*Next up: **Topic 44 — Design a Distributed Cache**, where we explore eviction policies, cache invalidation strategies, thundering herd mitigation, and the design of systems like Memcached and Redis Cluster.*

---

<!--
Topic: 44
Title: Design a Distributed Cache
Section: 09 — Real-World Designs Part 1
Track: 0-to-100 Deep Mastery
Difficulty: mid-senior
Interview Weight: high
Prerequisites: Topics 10, 19, 43
Next Topic: Topic 45 (Design a Chat System)
Version: 1.0
-->

## Topic 44: Design a Distributed Cache

---

### Section 1 — Why This Design?

In 2003, Brad Fitzpatrick faced a problem that every fast-growing web application eventually encounters: the database could not keep up with read traffic. LiveJournal, the social networking and blogging platform he maintained, was buckling under load. The relational database was handling the same queries thousands of times per second — fetching the same user profiles, the same blog posts, the same friend lists — and each query consumed CPU cycles, disk I/O, and connection pool slots. Fitzpatrick's solution was Memcached, a simple in-memory key-value store that sat between the application and the database. The idea was deceptively straightforward: if you have already computed or fetched a result, store it in fast memory so you never have to do that work again. Memcached was open-sourced and within a few years became the backbone of nearly every major web application on the internet.

Facebook took this idea and scaled it to an extreme that Fitzpatrick never anticipated. By 2013, Facebook operated the largest Memcached deployment in the world — thousands of servers holding trillions of cached items, handling billions of requests per second. Their engineering team published a landmark paper ("Scaling Memcache at Facebook") that described the infrastructure they built: mcrouter, a proxy layer that handled routing, replication, and failover; regional cache pools that reduced cross-datacenter traffic; lease mechanisms that solved the thundering herd problem; and a tiered architecture that separated hot data from warm data. Facebook also built TAO, a graph-aware caching layer for social graph queries, and McDipper, a flash-based cache for data that was accessed frequently enough to warrant caching but not frequently enough to justify RAM. These systems taught the industry that distributed caching is not just "put Memcached in front of your database" — it is a complex distributed systems problem with its own consistency challenges, failure modes, and scaling bottlenecks.

Meanwhile, Salvatore Sanfilippo created Redis in 2009 as a "data structure server" — a cache that understood lists, sets, sorted sets, hashes, and streams, not just opaque blobs. Redis quickly became the Swiss Army knife of backend engineering: session store, leaderboard engine, rate limiter, pub/sub broker, and distributed lock coordinator. Its single-threaded event loop delivered predictable latency, and its persistence options (RDB snapshots, AOF logging) meant data could survive restarts. Redis Cluster, introduced in version 3.0, added automatic partitioning and failover, turning Redis into a distributed system in its own right. Today, Redis and Memcached remain the two dominant in-memory caching technologies, and every system design interview expects candidates to understand the principles behind them.

Caching is arguably the single most impactful performance optimization in all of computing. It appears at every layer of the stack: CPU L1/L2/L3 caches, OS page caches, database buffer pools, application-level caches, CDN edge caches, and browser caches. In a system design interview, "Design a Distributed Cache" tests your understanding of data partitioning, consistency trade-offs, eviction policies, failure handling, and performance engineering. It is one of the most frequently asked questions at companies like Amazon, Google, Meta, and Microsoft, and your answer reveals whether you can think about infrastructure at scale. This topic synthesizes concepts from consistent hashing (Topic 10), replication (Topic 19), and key-value store design (Topic 43) into a cohesive, production-grade system.

---

### Section 2 — Requirements Gathering

Before drawing any boxes on a whiteboard, you must establish what the system needs to do and how well it needs to do it. In an interview, spending two to three minutes on requirements gathering signals maturity and prevents you from designing a system that solves the wrong problem.

**Functional Requirements**

The core operations of a distributed cache are deceptively simple. The system must support `GET(key)` to retrieve a cached value, `SET(key, value, TTL)` to store a value with an optional time-to-live, and `DELETE(key)` to explicitly remove an entry. Beyond these basics, production caches typically support `MGET` and `MSET` for batch operations (critical for reducing network round trips), atomic increment/decrement operations (useful for counters and rate limiting), and conditional operations like `SET-IF-NOT-EXISTS` (essential for distributed locking). The cache must support configurable eviction policies — when memory is full and a new item needs to be stored, the system must decide which existing item to remove. Common policies include LRU (Least Recently Used), LFU (Least Frequently Used), FIFO (First In First Out), and TTL-based expiration. Clients should be able to configure TTL per key, and the system should support both lazy expiration (check TTL on access) and active expiration (background sweeper removes expired keys).

**Non-Functional Requirements**

The entire point of a cache is speed, so latency is the primary non-functional requirement. Read operations should complete in sub-millisecond time for local cache hits and under 1-2 milliseconds for network-based cache hits. The system must support high throughput — on the order of 1 million operations per second per node, with the aggregate cluster handling tens of millions of operations per second. Horizontal scalability is essential: adding more cache nodes should linearly increase both capacity and throughput. Fault tolerance means that the failure of a single cache node should not cause a system-wide outage — it should only result in cache misses for the keys that were stored on that node, and the system should redistribute those keys or let the database handle them temporarily. Availability is more important than consistency for most caching use cases — serving stale data for a few seconds is almost always preferable to returning an error or waiting for a slow database query.

**Back-of-Envelope Estimation**

Let us size the system for a mid-scale deployment. Assume 10 million cache entries with an average value size of 1 KB and an average key size of 100 bytes. The raw data storage requirement is:

```
Key storage:   10M keys x 100 bytes   = 1 GB
Value storage: 10M keys x 1 KB        = 10 GB
Metadata overhead (pointers, TTL, hash entries): ~40% of data
Total per-entry overhead: ~50 bytes for hash table entry
                         + 16 bytes for LRU linked list pointers
                         + 8 bytes for TTL timestamp
                         + 8 bytes for key length/value length
                         = ~82 bytes per entry

Metadata total: 10M x 82 bytes = 820 MB (~0.82 GB)

Total memory needed: 1 + 10 + 0.82 = ~12 GB
With safety margin (70% utilization target): 12 / 0.7 = ~17 GB
```

For throughput, assume 500,000 reads per second and 50,000 writes per second (a 10:1 read-to-write ratio, typical for caching workloads). Each operation involves a network round trip (approximately 0.1-0.5 ms on a local network), a hash table lookup (O(1) in memory), and a serialization/deserialization step. A single modern server with 64 GB of RAM can handle well over 1 million operations per second (Redis benchmarks show 100K-500K ops/sec on a single thread; Memcached with multiple threads can exceed 1M ops/sec). For our workload of 550K total ops/sec, two to three cache servers would suffice for throughput, but we would deploy at least three for fault tolerance.

Network bandwidth estimation:

```
Read traffic:  500K/sec x (100 bytes key + 1 KB value) = 500K x 1.1 KB = 550 MB/sec
Write traffic: 50K/sec x (100 bytes key + 1 KB value)  = 50K x 1.1 KB  = 55 MB/sec
Total:         ~605 MB/sec = ~4.8 Gbps

Each server with a 10 Gbps NIC can handle the full load,
but distributed across 3 servers: ~1.6 Gbps each (comfortable margin).
```

This estimation tells us the system is memory-bound, not CPU-bound or network-bound, which is typical for in-memory caches.

---

### Section 3 — High-Level Architecture

The high-level architecture of a distributed cache consists of three main layers: the client library that routes requests, the cache server fleet that stores data in memory, and the underlying data source (typically a database) that serves as the source of truth. The interaction between these layers depends on which caching pattern you choose, and understanding the trade-offs between these patterns is one of the most important aspects of the design.

```
+-------------------+     +-------------------+     +-------------------+
|   Application     |     |   Application     |     |   Application     |
|   Server 1        |     |   Server 2        |     |   Server 3        |
| +---------------+ |     | +---------------+ |     | +---------------+ |
| | Cache Client  | |     | | Cache Client  | |     | | Cache Client  | |
| | (Consistent   | |     | | (Consistent   | |     | | (Consistent   | |
| |  Hashing)     | |     | |  Hashing)     | |     | |  Hashing)     | |
| +-------+-------+ |     | +-------+-------+ |     | +-------+-------+ |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
          +-------------------------+-------------------------+
          |                         |                         |
  +-------v-------+       +--------v------+       +----------v----+
  | Cache Server 1|       | Cache Server 2|       | Cache Server 3|
  | (Hash Range   |       | (Hash Range   |       | (Hash Range   |
  |  0 - 0x55...) |       |  0x55 - 0xAA) |       |  0xAA - 0xFF) |
  | [Memory: LRU  |       | [Memory: LRU  |       | [Memory: LRU  |
  |  Hash Table]  |       |  Hash Table]  |       |  Hash Table]  |
  +-------+-------+       +-------+-------+       +-------+-------+
          |                        |                        |
          +------------------------+------------------------+
                                   |
                          +--------v--------+
                          |    Database     |
                          | (Source of      |
                          |  Truth)         |
                          +-----------------+
```

**Cache-Aside (Lazy Loading)** is the most common pattern. The application checks the cache first. On a cache hit, it returns the cached value directly. On a cache miss, it queries the database, stores the result in the cache with a TTL, and then returns the value to the caller. The application code is responsible for all cache management. This pattern is simple and works well because it only caches data that is actually requested (no wasted memory on unpopular data), and the cache naturally adapts to changing access patterns. The downside is that every cache miss incurs the latency of both the cache lookup (a miss) and the database query, and there is a risk of cache-aside race conditions where two concurrent requests both experience a cache miss and both write to the cache, potentially with different values if the database was updated between the two reads.

**Read-Through** moves the cache interaction logic out of the application and into the cache layer itself. The application always asks the cache for data, and if the cache does not have it, the cache itself fetches from the database, stores the result, and returns it. This simplifies the application code — it does not need to know about cache misses at all — but it couples the cache to the data source and requires the cache to understand how to query the database, which limits flexibility.

**Write-Through** ensures that every write goes to both the cache and the database synchronously. When the application writes data, it writes to the cache, and the cache immediately writes to the database before returning success. This guarantees that the cache and database are always consistent, but it adds latency to every write operation (the write is not complete until both the cache and database have acknowledged it). Write-through is often combined with read-through to create a fully transparent caching layer.

**Write-Behind (Write-Back)** is the most aggressive pattern. Writes go to the cache immediately, and the cache asynchronously flushes dirty entries to the database in the background, often in batches. This dramatically reduces write latency (the application only waits for the in-memory cache write) and can reduce database load through write coalescing (multiple updates to the same key result in only one database write). However, it introduces the risk of data loss — if the cache node crashes before flushing dirty entries to the database, those writes are lost. Write-behind is used in systems where write performance is critical and some data loss is acceptable.

**Data Flow for Cache Hit:**

```
1. Application receives request for key "user:1234"
2. Cache client hashes "user:1234" -> maps to Cache Server 2
3. Cache client sends GET("user:1234") to Cache Server 2
4. Cache Server 2 finds key in hash table, checks TTL (not expired)
5. Cache Server 2 updates LRU position (move to head of list)
6. Cache Server 2 returns value to cache client
7. Application returns response to user
Total latency: ~0.5-1ms (network RTT + hash lookup)
```

**Data Flow for Cache Miss:**

```
1. Application receives request for key "user:1234"
2. Cache client hashes "user:1234" -> maps to Cache Server 2
3. Cache client sends GET("user:1234") to Cache Server 2
4. Cache Server 2 does not find key (or key has expired)
5. Cache Server 2 returns MISS to cache client
6. Application queries database for user 1234
7. Database returns user data (latency: 5-50ms)
8. Application sends SET("user:1234", data, TTL=300s) to Cache Server 2
9. Cache Server 2 stores entry, possibly evicting an old entry if memory is full
10. Application returns response to user
Total latency: ~6-51ms (cache miss + DB query + cache write)
```

---

### Section 4 — Deep Dive: Eviction Policies

When a cache is full and a new entry needs to be stored, the cache must decide which existing entry to evict. This decision has a profound impact on cache hit rates, and therefore on overall system performance. A poor eviction policy means more cache misses, more database queries, higher latency, and wasted memory on items that are unlikely to be accessed again.

**LRU (Least Recently Used)** is the most widely used eviction policy and the default in both Redis and Memcached. The intuition behind LRU is temporal locality: if an item was accessed recently, it is likely to be accessed again soon. If an item has not been accessed in a long time, it is a good candidate for eviction. The classic implementation uses a doubly-linked list combined with a hash map. The hash map provides O(1) lookup by key, and the doubly-linked list maintains access order. Every time an item is accessed (GET or SET), it is moved to the head of the list. When an eviction is needed, the item at the tail of the list (the least recently used) is removed. Both operations — moving to head and removing from tail — are O(1) in a doubly-linked list.

The challenge with a strict LRU implementation in a high-throughput cache is the overhead of maintaining the linked list. Every single GET operation requires acquiring a lock (or using lock-free techniques) to move the accessed node to the head of the list. In a system handling millions of reads per second, this becomes a significant contention point. Redis solves this problem with an approximation: instead of maintaining a true LRU linked list, Redis samples a small number of random keys (configurable, default 5) and evicts the one among the sample that was least recently used. This approximation is remarkably effective — Redis documentation shows that with a sample size of 10, the behavior is nearly indistinguishable from true LRU, and the implementation is much simpler and faster because it avoids the linked list entirely. Each key simply stores a timestamp of its last access, and eviction samples random keys and compares timestamps.

**LFU (Least Frequently Used)** evicts the item that has been accessed the fewest times. This is better than LRU for workloads with frequency skew — if a small set of keys is accessed extremely frequently (e.g., a celebrity's profile or a viral post), LFU will keep those keys cached even if there is a burst of one-time accesses to other keys that would push them out under LRU. The naive implementation maintains an access counter per key and evicts the key with the lowest counter. The problem is that counters grow without bound and do not account for recency — an item that was extremely popular last week but is no longer accessed will have a high counter and never be evicted. The solution is frequency aging: periodically divide all counters by 2 (or apply a decay function) so that old popularity fades over time. Redis implements LFU with a logarithmic counter that saturates at 255 and decays based on a configurable time constant.

**Window-TinyLFU**, used in the Caffeine caching library (the standard Java caching library), combines the strengths of LRU and LFU. It maintains a small "window" cache using LRU (to handle burst traffic and new entries), a "probation" segment using LFU (to identify frequently accessed items), and a "protected" segment using LRU (for items that have proven their frequency). When a new item enters the cache, it goes into the window. When the window is full, evicted items compete with evicted items from the probation segment, and the one with higher estimated frequency wins. This admission policy filters out one-time access items while retaining both recently popular and consistently popular items. The frequency estimation uses a Count-Min Sketch, a probabilistic data structure that provides approximate frequency counts in constant space.

**FIFO (First In First Out)** evicts the oldest item in the cache, regardless of access pattern. It is simple to implement (just a queue) and has no per-access overhead (no need to update position on GET). FIFO works well when access patterns are scan-like (each item is accessed roughly once) but performs poorly for temporal locality workloads. It is rarely used as a primary eviction policy in production caches, but it appears as a component in more sophisticated policies like FIFO-Reinsertion (also known as CLOCK), which gives eviction candidates a "second chance" based on a reference bit.

**Random Eviction** picks a random key to evict. It sounds crude, but it is surprisingly effective for uniform access distributions and has zero overhead — no linked lists, no counters, no timestamps. For highly skewed distributions (where a few keys account for most of the traffic), random eviction performs poorly because it is equally likely to evict a hot key as a cold key. Redis supports random eviction as a policy option for workloads where simplicity and speed matter more than optimal hit rates.

**TTL-Based Expiration** is not strictly an eviction policy but a complementary mechanism. Each key can have a time-to-live, after which it is considered expired and eligible for removal. TTL serves two purposes: it provides a correctness guarantee (cached data will not be stale for longer than the TTL), and it provides a natural eviction mechanism (expired keys free up memory without needing to make eviction decisions). Redis implements TTL expiration using a combination of lazy expiration (check TTL when a key is accessed and delete if expired) and active expiration (a background task that periodically samples random keys with TTLs and deletes expired ones). The active expiration runs 10 times per second by default and samples 20 keys each time; if more than 25% of sampled keys are expired, it repeats immediately, ensuring that expired keys do not accumulate.

The choice of eviction policy depends on the workload. For general-purpose web application caching, LRU is the safe default. For workloads with strong frequency skew (e.g., social media where a few popular profiles receive the vast majority of reads), LFU or Window-TinyLFU provides better hit rates. For simple session stores or task queues where access order matters, FIFO is adequate.

---

### Section 5 — Distributed Architecture

A single cache server, no matter how powerful, has limits: a finite amount of RAM, a maximum number of network connections, and a ceiling on throughput. To scale beyond these limits, we distribute the cache across multiple servers, partitioning the key space so that each server is responsible for a subset of keys. The fundamental question in distributed caching is: given a key, which server should store it?

**Consistent Hashing** is the standard answer. Traditional modular hashing (`server = hash(key) % N`) has a fatal flaw: when you add or remove a server (change N), nearly every key maps to a different server, causing a massive spike in cache misses. Consistent hashing maps both keys and servers onto a ring (typically a 2^32 or 2^128 space). Each key is assigned to the first server encountered when walking clockwise from the key's position on the ring. When a server is added, only the keys between the new server and its predecessor on the ring need to be remapped. When a server is removed, only its keys are remapped to the next server on the ring. In both cases, the disruption is proportional to 1/N (where N is the number of servers) rather than affecting all keys.

```
                     Server A
                        |
                  ------+------
                /       |       \
              /         |         \
            /           |           \
   Key "x" *     [Hash Ring]     * Key "z"
            \           |           /
              \         |         /
                \       |       /
                  ------+------
                /       |       \
          Server C      |      Server B
                        |
                     Key "y"

Keys are assigned to the nearest server clockwise on the ring.
Adding Server D between A and B only remaps keys in that arc.
```

**Virtual Nodes** solve the problem of uneven distribution. With only three physical servers on a ring, the arc sizes (and therefore the number of keys per server) can vary wildly. Virtual nodes create multiple positions on the ring for each physical server — for example, 150 virtual nodes per physical server. This provides a much more even distribution of keys across servers. When a physical server is added or removed, its virtual nodes are scattered across the ring, so the keys it gains or loses are spread evenly across the other servers rather than all coming from a single neighbor. In practice, 100-200 virtual nodes per physical server provides good balance with acceptable memory overhead for the ring metadata.

**Client-Side vs Server-Side Partitioning** is an architectural decision with significant implications. In client-side partitioning (used by Memcached and many Redis deployments), the cache client library contains the consistent hashing logic and directly connects to the appropriate cache server. This is simple and eliminates a network hop, but every client must maintain an up-to-date view of the server topology, and different client implementations might hash keys differently, leading to inconsistencies. In server-side partitioning (used by Redis Cluster), the cache servers themselves know the partitioning scheme. A client can send a request to any server; if that server does not own the key, it redirects the client to the correct server (a MOVED response in Redis Cluster). This centralizes the routing logic but adds latency for redirected requests. A hybrid approach uses a proxy layer (like Facebook's mcrouter or Twemproxy) that sits between clients and servers, handling routing, replication, and failover. The proxy adds one network hop but centralizes configuration and simplifies client logic.

**Facebook's mcrouter Architecture** deserves special attention because it represents the most battle-tested distributed cache design in the world. mcrouter is a Memcached protocol-compatible proxy that runs on every application server as a local process. It handles consistent hashing, connection pooling (reducing the number of TCP connections to each Memcached server from thousands to a handful), request routing (including fanout for multi-get operations), replication (writing to multiple pools for redundancy), failover (detecting dead servers and rerouting traffic), and shadowing (sending a copy of traffic to a test pool for validation). mcrouter enables Facebook to operate multiple cache pools with different characteristics: a "wildcard" pool for general caching, a "regional" pool that is local to each datacenter, and a "leader" pool for data that must be consistent across regions. This architecture separates the caching logic from the application code, allowing the infrastructure team to change the cache topology without modifying any application.

**Redis Cluster vs Redis Sentinel** represents two different approaches to distributed Redis. Redis Sentinel provides high availability for a single Redis master by monitoring it and promoting a replica to master if the master fails. It does not partition data — all data lives on one master, and replicas are read-only copies. Sentinel is appropriate when your dataset fits on a single server and you need automatic failover. Redis Cluster, in contrast, partitions data across multiple masters (each responsible for a range of hash slots from 0 to 16383) and each master can have replicas for failover. Cluster provides both scalability (more masters = more memory and throughput) and availability (replicas can be promoted if a master fails). The trade-off is complexity: Redis Cluster has limitations on multi-key operations (all keys in a transaction must be on the same hash slot), requires careful slot migration when adding or removing nodes, and has more complex failure detection and recovery logic.

---

### Section 6 — Cache Consistency

Phil Karlton famously said, "There are only two hard things in Computer Science: cache invalidation and naming things." Cache consistency is the reason caching is a distributed systems problem and not just a performance trick. Every time you cache a value, you create a copy of data that can diverge from the source of truth. Managing this divergence — deciding when stale data is acceptable, when it is not, and how to minimize the window of inconsistency — is the central challenge of distributed cache design.

**TTL-Based Invalidation** is the simplest consistency strategy. Every cached entry has a time-to-live, and after that time, the entry is considered stale and will be refreshed from the database on the next access. TTL provides a bounded staleness guarantee: cached data is never more than TTL seconds out of date. The choice of TTL depends on the data's update frequency and the application's tolerance for staleness. User profile data that changes rarely might have a TTL of 5 minutes. A stock price might have a TTL of 1 second. Session data might have a TTL of 30 minutes (matching the session timeout). The weakness of TTL-based invalidation is that it is not reactive — if the underlying data changes, the cache will serve stale data until the TTL expires, even if the system "knows" the data has changed.

**Event-Driven Invalidation** addresses this weakness by actively invalidating or updating cached entries when the underlying data changes. When a write occurs in the database, an event is published (via a message queue, change data capture stream, or database trigger) that causes the relevant cache entries to be deleted or updated. This reduces the staleness window from the TTL duration to the event propagation latency (typically milliseconds). Facebook uses this approach extensively: when a user updates their profile, the write goes to the database, and a cache invalidation event is sent to all cache pools that might have a copy of that user's data. The challenge is ensuring that invalidation events are reliable (not lost), ordered (an older version does not overwrite a newer one), and complete (all copies are invalidated, not just some).

**The Cache Stampede (Thundering Herd) Problem** occurs when a popular cache entry expires and many concurrent requests simultaneously experience a cache miss and all query the database for the same data. If a key served 10,000 reads per second, and the TTL expires, all 10,000 concurrent readers will hit the database at the same instant, potentially overwhelming it. This problem is particularly dangerous because it can cascade — the database slows down under the stampede, which causes more requests to time out and retry, which adds even more load. Several solutions exist:

**Locking (Lease-based)**: When a cache miss occurs, the first request acquires a lock (or "lease" in Facebook's terminology) and fetches from the database. Subsequent requests for the same key see the lock and either wait for the first request to populate the cache or return a stale value if one is available. Facebook's Memcached implementation uses leases — the cache server issues a lease token on a miss, and only the holder of the lease token can SET the value. Other clients that request the same key during the lease period receive a "lease in progress" response and can either wait or use a slightly stale value.

**Probabilistic Early Expiration (XFetch)**: Instead of all copies expiring at exactly the same time, each access to a cached entry probabilistically decides whether to refresh the entry before the TTL expires. The probability of early refresh increases as the entry approaches its expiration time. The formula, proposed in the "Optimal Probabilistic Cache Stampede Prevention" paper, is: `refetch = (currentTime - (expiry - TTL)) > (beta * random() * computeTime)`, where beta controls the aggressiveness of early refresh and computeTime is the estimated time to recompute the value. This ensures that, on average, exactly one request will refresh the value before it expires, preventing the stampede without any locking.

**Stale-While-Revalidate**: The cache continues to serve the stale value while one background request refreshes it from the database. This is similar to the HTTP `stale-while-revalidate` cache-control directive. The user sees the stale value (which is usually acceptable for a brief period), and the cache is updated asynchronously. This eliminates the latency spike for the unlucky request that triggers the refresh.

**Cache-Aside Race Conditions** are a subtle consistency problem. Consider this sequence: (1) Thread A reads key K from the cache — cache miss. (2) Thread A reads K from the database, gets value V1. (3) Thread B updates K in the database to value V2. (4) Thread B deletes K from the cache (invalidation). (5) Thread A writes V1 to the cache (from step 2). Now the cache contains the stale value V1 while the database has V2, and this inconsistency will persist until the TTL expires. This race condition is inherent to the cache-aside pattern. Mitigations include using short TTLs (limiting the staleness window), using a version number or CAS (Compare-And-Swap) operation to reject stale writes, or using Facebook's lease mechanism (the lease issued in step 1 would be invalidated by the deletion in step 4, so the SET in step 5 would fail).

Maintaining consistency between cache and database across distributed systems with multiple datacenters is even more challenging. Facebook's approach is to designate one datacenter as the "master" region and use database replication to propagate writes to "slave" regions. When a write occurs in the master region, the cache invalidation is sent to the master region's cache immediately. For slave regions, the invalidation is embedded in the database replication stream (using MySQL replication events) so that the slave region's cache is invalidated only after the database replica has received the write. This ensures that a slave region never serves a stale cached value by reading from a database replica that has not yet received the update.

---

### Section 7 — Scaling and Performance

Building a distributed cache that handles millions of operations per second requires careful attention to memory management, network efficiency, and hot spot mitigation. The difference between a cache that achieves 100K ops/sec and one that achieves 1M ops/sec on the same hardware often comes down to these low-level engineering decisions.

**Memory Management and the Slab Allocator** is critical for cache performance and efficiency. Naive memory allocation using malloc/free for each cache entry leads to memory fragmentation over time — as entries of different sizes are allocated and freed, the heap becomes a patchwork of used and free blocks, and the allocator may not be able to satisfy a request even when the total free memory is sufficient. Memcached solves this with a slab allocator: memory is divided into slab classes, where each class stores items of a specific size range (e.g., 96 bytes, 120 bytes, 152 bytes, up to 1 MB, with each class roughly 1.25x the previous one). Within each slab class, memory is divided into fixed-size chunks. When an item needs to be stored, it is placed in the smallest slab class that can fit it. This eliminates external fragmentation (because all chunks within a slab class are the same size) but introduces internal fragmentation (a 97-byte item stored in a 120-byte chunk wastes 23 bytes). The trade-off is worthwhile because allocation and deallocation are O(1) operations (just grab the next free chunk from the appropriate slab class), and the predictable allocation pattern leads to stable performance under load. Redis uses jemalloc, a general-purpose allocator that provides good fragmentation behavior without requiring the application to manage slab classes explicitly.

**Connection Pooling** is essential for reducing the overhead of TCP connections. A typical web application server might have hundreds of worker threads, each potentially needing to communicate with every cache server. Without connection pooling, this creates N_workers x N_cache_servers TCP connections, which can easily reach tens of thousands. Each TCP connection consumes memory (kernel buffers, application state) and file descriptors on both sides. Connection pooling maintains a shared pool of connections that are reused across requests. Facebook's mcrouter takes this further by acting as a local connection multiplexer: all worker threads on an application server communicate with mcrouter through local connections, and mcrouter maintains a small number of connections to each cache server, multiplexing thousands of logical requests over a handful of physical connections.

**Pipelining and Batching** dramatically improve throughput by amortizing network overhead. Instead of sending one command and waiting for the response before sending the next, pipelining sends multiple commands in rapid succession without waiting for individual responses, and the server processes them in order and sends responses in order. Redis pipelining can improve throughput by 5-10x compared to individual commands because it reduces the impact of network round-trip time. Batching combines multiple operations into a single request (like MGET for retrieving multiple keys at once). When a web page requires 50 different cached values to render, using MGET to fetch all 50 in a single round trip is dramatically faster than 50 individual GET commands. In a distributed cache, the client library must be smart about batching: it groups keys by their target server (based on consistent hashing), sends parallel MGET requests to each server, and assembles the results.

**The Hot Key Problem** occurs when a single key receives a disproportionate amount of traffic — for example, a celebrity's profile, a viral tweet, or a flash sale product. Because consistent hashing assigns each key to exactly one server, all requests for that hot key go to the same server, creating a bottleneck. Even if the overall traffic is evenly distributed across the cluster, one hot key can saturate a single server's CPU, memory bandwidth, or network interface. Solutions include:

Local caching (L1 cache): Each application server maintains a small, short-TTL in-memory cache (using a library like Guava or Caffeine in Java, or a simple Map in Node.js). Hot keys are cached locally, and only cache misses go to the distributed cache. This adds a layer of complexity (now you have two layers of cache to invalidate) but can absorb enormous read traffic for hot keys with minimal latency.

Key replication: Instead of storing a hot key on one server, replicate it across multiple servers. The client library appends a random suffix (e.g., `user:celebrity#1`, `user:celebrity#2`, ..., `user:celebrity#10`) and distributes reads across these replicated keys. Writes must update all replicas. This is effective but requires the client to know which keys are hot (which may change dynamically).

Consistent hashing with replicas: Configure the consistent hashing ring so that reads for any key can be served by the primary server or its K successors on the ring. This provides automatic load distribution for all keys (not just identified hot keys) at the cost of potentially serving slightly stale data if updates have not propagated to all replicas.

**Cold Start and Cache Warming** addresses the problem of deploying a new cache or recovering from a cache failure. An empty cache has a 0% hit rate, meaning all requests go to the database, which may not be able to handle the full load. Cache warming preloads the cache with data before it starts receiving traffic. Strategies include: replaying recent access logs to populate the cache with recently-accessed keys, using a shadow deployment that receives a copy of production traffic to warm up before being promoted to primary, gradually shifting traffic to the new cache (starting at 1%, then 5%, then 10%, etc.) to allow it to warm up under controlled load, and seeding the cache from a snapshot of an existing cache server's data. Facebook uses a combination of these approaches when bringing up new cache pools or recovering from regional failures.

---

### Section 8 — Failure Handling

Caches, by their nature as performance optimizations, occupy a unique position in system reliability: the system should work correctly without the cache, just more slowly. This principle — that the cache is an optimization, not a dependency — must guide all failure handling design. However, in practice, many systems become so dependent on their cache that a cache failure causes a cascading outage. Designing for graceful degradation requires deliberate engineering.

**When a Cache Node Dies**, the impact depends on the partitioning strategy. With consistent hashing, only the keys assigned to the dead node become uncacheable. Requests for those keys will experience cache misses and fall through to the database. The fraction of the key space affected is approximately 1/N (where N is the number of cache nodes), so with 10 cache servers, a single server failure causes roughly a 10% increase in database load. This is the beauty of consistent hashing — the "blast radius" of a failure is limited to one partition.

However, even a 10% increase in database load can be dangerous if the database is already running at 90% capacity (which is common, since the whole point of the cache is to keep database load manageable). The sudden spike in database queries from the cache misses can push the database past its limits, causing slow queries, connection pool exhaustion, and timeouts. This is a **cache miss storm** — a cascading failure triggered by a cache failure. The miss storm can be worse than the original failure because the database, now overloaded, starts timing out, which causes retries, which add even more load.

**Consistent Hashing Limits the Blast Radius** but does not eliminate it. When the dead node's keys are remapped to the next node on the ring, that node receives all the miss traffic. If the dead node had hot keys, the successor node may be overwhelmed. Virtual nodes help distribute this impact more evenly — with 150 virtual nodes per physical server, the dead server's keys are distributed across many successor nodes rather than concentrated on one.

**Circuit Breaker to Database** is a critical protection mechanism. When cache miss rates spike (indicating a cache failure or cold start), a circuit breaker monitors the database error rate and response time. If the database shows signs of overload (response time exceeding a threshold, error rate exceeding a threshold), the circuit breaker "opens" and starts rejecting cache miss requests immediately, returning an error or a degraded response to the client instead of sending more queries to the already-struggling database. After a cool-down period, the circuit breaker "half-opens" and allows a small number of test queries through. If they succeed, the circuit breaker "closes" and allows normal traffic to resume. This pattern prevents a cache failure from cascading into a database failure.

**Graceful Degradation** strategies include serving stale data when the cache is unavailable (if the application maintains a local stale copy or if a secondary cache tier is available), reducing functionality (e.g., showing a simplified page that requires fewer cached values), rate limiting cache-miss-driven database queries (allowing only N database queries per second per key, queuing the rest), and returning pre-computed fallback values for critical data (e.g., showing a default product recommendation instead of a personalized one). The key insight is that in most applications, serving stale data or reduced data is far better than returning an error. Users will not notice that the trending topics list is 30 seconds old, but they will notice a 500 error.

**Monitoring Cache Hit Rates and Eviction Rates** is essential for detecting problems before they become outages. The cache hit rate (hits / (hits + misses)) is the single most important metric for a cache. A healthy cache typically has a hit rate above 95%. A drop in hit rate indicates a problem: increased working set size (the cache is too small), a change in access patterns, a hot key eviction issue, or a node failure. The eviction rate (evictions per second) indicates memory pressure — if evictions are high, the cache is full and actively discarding data to make room. High eviction rates combined with a low hit rate suggest the cache is too small for the workload. Other critical metrics include latency percentiles (p50, p95, p99), connection counts, memory usage, and network bandwidth. Redis provides these metrics via the `INFO` command, and Memcached exposes them via the `stats` command. Production caches should export these metrics to a time-series database (like Prometheus) and have alerts configured for anomalies.

---

### Section 9 — Trade-Offs and Design Decisions

Every design decision in a distributed cache involves trade-offs. Understanding these trade-offs — not just knowing the options, but being able to articulate why you would choose one over the other for a specific use case — is what distinguishes a strong system design interview answer from a mediocre one.

**Memory vs Disk**: In-memory caches (Redis, Memcached) provide sub-millisecond latency but are limited by the cost of RAM (roughly $5-10 per GB per month in the cloud). Disk-backed caches (Facebook's McDipper, which used flash storage) provide orders-of-magnitude more capacity at lower cost but with higher latency (0.1-1ms for NVMe SSD vs 0.001ms for RAM). The decision depends on the access pattern: data accessed thousands of times per second belongs in RAM; data accessed a few times per minute might be better on SSD. A tiered architecture uses both — a small RAM cache (L1) in front of a larger SSD cache (L2) in front of the database. Items that are accessed frequently enough are promoted to the RAM tier; items that cool off are demoted to the SSD tier.

**Consistency vs Performance**: Stronger consistency (write-through, synchronous invalidation) adds latency to writes and requires coordination between the cache and database. Weaker consistency (TTL-based expiration, eventual invalidation) allows faster writes and simpler architecture but tolerates stale reads. Most caching use cases favor performance over consistency — the whole point of caching is speed, and if you add so much consistency overhead that the cache is slow, you might as well query the database directly. The exception is caching of financial data, inventory counts, or security-sensitive data where serving stale values can cause real harm.

**Centralized vs Distributed**: A single large cache server is simpler to operate, has no partitioning overhead, supports all operations (including multi-key transactions), and is easy to reason about. A distributed cache scales horizontally, tolerates individual node failures, and can handle larger datasets. The decision point is usually the dataset size and throughput requirement: if your data fits in 64 GB and your throughput fits within a single server's capacity (1M+ ops/sec for Memcached, 100K-500K for Redis), a single server with a replica is the simpler choice. Beyond that, you need distribution.

**Client-Side vs Proxy-Based Routing**: Client-side routing (the client library knows the ring topology and connects directly to the appropriate server) has lower latency (no proxy hop) and no single point of failure in the routing layer. Proxy-based routing (mcrouter, Twemproxy, Envoy) centralizes configuration, simplifies clients, enables advanced features (shadowing, failover, replication), and allows the infrastructure team to change the topology without updating every client. The trend in the industry has been toward proxy-based routing for large deployments (Facebook, Netflix) because the operational benefits outweigh the small latency cost.

**Replication vs Partitioning**: Replication (copying all data to multiple servers) improves read throughput and availability but does not increase capacity — each server still stores the full dataset. Partitioning (splitting data across servers) increases capacity and write throughput but means each key is on only one server (unless combined with replication). Most production caches use both: partition the key space across multiple masters for capacity and throughput, and replicate each partition to one or more replicas for availability. Redis Cluster uses this approach: 16384 hash slots are distributed across masters, and each master can have replicas.

**Redis vs Memcached**: This is one of the most common interview comparison questions. Memcached is simpler, multi-threaded (better multi-core utilization out of the box), and uses a slab allocator for predictable memory management. It supports only simple key-value pairs with string values. Redis is single-threaded (with I/O threading in Redis 6+), supports rich data structures (lists, sets, sorted sets, hashes, streams, bitmaps, HyperLogLogs), provides persistence options (RDB, AOF), supports Lua scripting for server-side logic, and has built-in pub/sub and clustering. Choose Memcached for simple, high-throughput key-value caching where you need maximum ops/sec per dollar. Choose Redis when you need data structures (leaderboards with sorted sets, session management with hashes, rate limiting with atomic increments, pub/sub for real-time features) or when you need persistence to survive restarts.

---

### Section 10 — Interview Questions

**Beginner Tier**

**Q1: What is the difference between cache-aside and read-through caching patterns?**

In cache-aside (also called lazy loading), the application is responsible for all cache interactions. When the application needs data, it first checks the cache. If the data is there (cache hit), it uses it directly. If the data is not there (cache miss), the application queries the database, writes the result to the cache, and then uses the data. The cache itself has no knowledge of the database — it is a passive store. In read-through, the cache sits between the application and the database as an active intermediary. The application always requests data from the cache, and if the cache does not have it, the cache itself fetches the data from the database, stores it, and returns it to the application. The application never interacts with the database directly for reads. The key trade-off is simplicity vs coupling: cache-aside keeps the cache simple and generic (it works with any data source) but puts the burden of cache management on the application. Read-through simplifies the application code but couples the cache to the data source, requiring the cache to know how to query the database.

**Q2: Why does consistent hashing matter for a distributed cache?**

Consistent hashing determines which cache server stores which keys, and it does so in a way that minimizes disruption when servers are added or removed. With naive modular hashing (server = hash(key) % N), adding or removing a server changes N, which remaps nearly every key to a different server. For a cache with 10 million entries across 10 servers, removing one server means ~9 million keys are now mapped to different servers, causing 90% of requests to experience cache misses. This miss storm can overwhelm the database. Consistent hashing maps keys and servers onto a ring, and each key is assigned to the nearest server clockwise. When a server is removed, only the keys that were assigned to that server are remapped (to the next server on the ring) — roughly 10% of keys for a 10-server cluster. This bounded blast radius is what makes consistent hashing essential for production distributed caches.

**Q3: What happens when a cache server goes down? How does the system continue to function?**

When a cache server fails, all keys stored on that server become temporarily unavailable from the cache. With consistent hashing, requests for those keys result in cache misses (the client either detects the server is down and routes to the next server on the ring, or the request times out and the client falls back). These cache misses flow through to the database, causing a temporary increase in database load proportional to the fraction of keys on the failed server (roughly 1/N for N servers). The system continues to function correctly because the database is the source of truth — the cache is an optimization, not a dependency. To mitigate the database load spike, the system can use a circuit breaker (to prevent overwhelming the database), rate limiting on cache-miss-driven queries, serving stale data from a secondary cache or local cache, and gradually warming a replacement cache server before routing full traffic to it.

**Mid-Level Tier**

**Q1: How would you solve the cache stampede (thundering herd) problem?**

The cache stampede occurs when a popular key expires and many concurrent requests simultaneously experience a cache miss, all querying the database for the same data. The best solution combines multiple techniques. First, use a locking mechanism: when a cache miss occurs, the first request sets a short-lived lock in the cache (e.g., `SET lock:key 1 NX EX 5` in Redis — "set only if not exists, expire in 5 seconds"). Only the lock holder fetches from the database and repopulates the cache. Other requests that see the lock either wait (blocking until the cache is repopulated, with a timeout), return a stale value if one is available (the cache stores both the current value and its TTL, and can serve the expired value while the refresh is in progress), or return a fallback/default value. Second, implement probabilistic early refresh: rather than all copies expiring at exactly the same time, each access probabilistically decides whether to refresh the entry before it expires. The probability increases as the expiry time approaches, ensuring that on average exactly one request refreshes the value before the TTL expires. Third, use stale-while-revalidate semantics: store an "effective TTL" (shorter) and a "hard TTL" (longer) for each entry. After the effective TTL, the entry is considered stale but still servable. The first request after the effective TTL triggers an asynchronous refresh while continuing to serve the stale value. The entry is only truly deleted after the hard TTL.

**Q2: How would you handle the hot key problem in a distributed cache?**

A hot key is a single key that receives a disproportionate share of traffic, creating a bottleneck on the cache server that owns it. The approach depends on whether the hot keys are predictable or unpredictable. For predictable hot keys (e.g., a scheduled product launch or a celebrity account), use key replication: create N copies of the key with different suffixes (e.g., `product:launch#0` through `product:launch#9`), distribute these across the cluster via consistent hashing, and have clients randomly select one suffix for each read. Writes must update all N copies. For unpredictable hot keys (e.g., a tweet that unexpectedly goes viral), use a local (L1) cache on each application server with a very short TTL (1-5 seconds). The local cache absorbs the repeated reads, and only one request per TTL period per application server reaches the distributed cache. To detect hot keys dynamically, instrument the cache client to track per-key request rates and automatically enable local caching when a key exceeds a threshold. Redis 7 added server-side tracking of hot keys (via the `HOTKEYS` option in `redis-cli`) to help with detection. The combination of local caching for reads and key replication for writes handles both predictable and unpredictable hot keys.

**Q3: Explain the race condition in cache-aside and how to prevent it.**

The race condition occurs in this sequence: (1) Thread A reads key K, gets a cache miss. (2) Thread A reads K from the database, gets value V1. (3) Between steps 2 and 5, Thread B updates K in the database to V2. (4) Thread B invalidates K in the cache (DELETE). (5) Thread A writes V1 (the stale value) to the cache. Now the cache holds V1 while the database holds V2, and this stale value will persist until the TTL expires. To prevent this, use a lease or version-based approach. Facebook's solution is leases: when a GET results in a cache miss, the cache server issues a lease token. The subsequent SET must include this lease token. If the key was invalidated (step 4) between the GET and the SET, the lease token is invalidated, and the SET in step 5 is rejected. The next reader will get another cache miss, fetch the current value V2 from the database, and successfully SET it. An alternative is to use CAS (Compare-And-Swap) with a version number: the database value includes a monotonically increasing version, and the SET only succeeds if no higher version has been written to the cache. Both approaches ensure that stale values cannot overwrite fresh values.

**Senior Tier**

**Q1: How would you design a multi-region distributed cache with consistency guarantees?**

Multi-region caching introduces the challenge of keeping caches consistent across geographically distributed datacenters with non-trivial network latency (50-200ms between regions). The architecture starts by designating one region as the "master" region where all writes go (either directly or via conflict resolution if writes occur in multiple regions). Each region has its own cache cluster. For reads, the local region's cache serves requests, providing low latency. For writes, the flow is: (1) The write goes to the master region's database. (2) The master region's cache is invalidated immediately. (3) The database replicates the write to other regions via asynchronous replication. (4) Cache invalidation for non-master regions is embedded in the database replication stream (not sent directly), ensuring that the remote region's cache is invalidated only after the remote database replica has the new data. This prevents the race condition where a remote cache is invalidated, a reader experiences a miss, reads from the local database replica (which has not yet received the write), and re-caches the stale value. Facebook implements this by having a component called "mcsqueal" that tails the MySQL replication stream and extracts cache invalidation commands. For applications that cannot tolerate the replication lag (typically 10-100ms), reads can be routed to the master region at the cost of higher latency. The cache client can use a "remote marker" mechanism: after a write, it sets a short-lived marker in the local cache indicating that this key was recently written. If the same user reads the key and sees the marker, the read is redirected to the master region, ensuring read-your-writes consistency.

**Q2: Design a tiered caching architecture for a system with 1 billion cache entries and varying access patterns.**

With 1 billion entries at an average of 1 KB each, the total data size is approximately 1 TB — far too much for RAM alone at a reasonable cost. A tiered architecture uses multiple cache layers: L1 (local in-process cache, RAM-based, ~100 MB per application server, TTL 1-5 seconds), L2 (distributed RAM cache like Redis/Memcached, 64-128 GB across the cluster, TTL 5-60 minutes), and L3 (distributed SSD-backed cache, 1-2 TB total, TTL hours to days). On a read request, the system checks L1 first, then L2, then L3, then the database. Writes go to the database and invalidate all cache layers. The key design decisions are promotion and demotion policies: items accessed more than K times in a time window are promoted from L3 to L2. Items evicted from L2 are demoted to L3 rather than discarded entirely. L1 is populated on every cache hit from L2 or L3, providing near-zero-latency access for the hottest keys. For sizing, apply the Pareto principle: the top 1% of keys (10 million) account for roughly 80% of reads, and they fit comfortably in the L2 RAM cache (10M x 1 KB = 10 GB). The next 10% (100 million, 100 GB) accounts for another 15% of reads and fits in the L3 SSD cache. The remaining 89% are accessed rarely enough that database reads with their slower latency are acceptable. Monitoring should track hit rates at each tier independently to validate the sizing and promotion policies.

**Q3: How would you migrate a live system from Memcached to Redis with zero downtime?**

Zero-downtime migration requires a phased approach. Phase 1 (Dual-Write): Modify the cache client to write to both Memcached and Redis on every SET and DELETE. Reads continue to go to Memcached only. This ensures Redis starts accumulating data without affecting the live read path. Run this for at least one full TTL cycle so Redis is warmed with current data. Phase 2 (Shadow-Read): Send all reads to both Memcached (the primary, whose result is returned to the caller) and Redis (the shadow, whose result is logged and compared but discarded). Compare the results to verify consistency — any discrepancy indicates a bug in the migration logic or a difference in serialization, TTL handling, or eviction behavior. Monitor the shadow hit rate to ensure Redis has warmed adequately. Phase 3 (Gradual Cutover): Use a feature flag or percentage-based rollout to route an increasing percentage of reads to Redis (1%, then 5%, 10%, 25%, 50%, 100%). At each step, monitor hit rates, latency percentiles, error rates, and database load. If any metric degrades, roll back to the previous percentage. Phase 4 (Cleanup): Once 100% of reads go to Redis and the system has been stable for a defined period (e.g., one week), remove writes to Memcached and decommission the Memcached cluster. Throughout the migration, ensure the cache client abstracts the underlying cache implementation so the application code does not need to change, and maintain a kill switch that can route all traffic back to Memcached within seconds if problems are discovered.

---

### Section 11 — Complete Code Example

The following implementation provides a complete distributed cache system in pseudocode and Node.js. We will build four components: an LRU cache, a consistent hashing ring, a cache-aside pattern with stampede protection, and a distributed cache client that ties everything together.

**Pseudocode: Distributed Cache Architecture**

```
PSEUDOCODE: Distributed Cache System

-- Data Structures --
STRUCTURE CacheEntry:
    key: String
    value: Any
    ttl_expiry: Timestamp
    created_at: Timestamp
    prev: Pointer<CacheEntry>    // For LRU doubly-linked list
    next: Pointer<CacheEntry>    // For LRU doubly-linked list

STRUCTURE LRUCache:
    capacity: Integer
    map: HashMap<String, CacheEntry>
    head: CacheEntry             // Most recently used (sentinel)
    tail: CacheEntry             // Least recently used (sentinel)

STRUCTURE HashRing:
    ring: SortedMap<Integer, String>  // hash position -> server ID
    vnodes_per_server: Integer
    servers: Set<String>

STRUCTURE DistributedCache:
    ring: HashRing
    connections: HashMap<String, Connection>
    local_cache: LRUCache        // L1 hot key cache
    locks: HashMap<String, Mutex>  // For stampede protection

-- LRU Cache Operations --
FUNCTION LRUCache.get(key):
    IF key NOT IN map:
        RETURN CACHE_MISS

    entry = map[key]

    // Check TTL expiration
    IF entry.ttl_expiry != 0 AND current_time() > entry.ttl_expiry:
        remove_node(entry)
        DELETE map[key]
        RETURN CACHE_MISS

    // Move to head (most recently used)
    remove_node(entry)
    insert_after_head(entry)

    RETURN entry.value

FUNCTION LRUCache.set(key, value, ttl_seconds):
    IF key IN map:
        // Update existing entry
        entry = map[key]
        entry.value = value
        entry.ttl_expiry = current_time() + ttl_seconds
        remove_node(entry)
        insert_after_head(entry)
    ELSE:
        // Evict if at capacity
        IF size(map) >= capacity:
            evict_entry = tail.prev   // Least recently used
            remove_node(evict_entry)
            DELETE map[evict_entry.key]

        // Insert new entry
        entry = new CacheEntry(key, value, current_time() + ttl_seconds)
        map[key] = entry
        insert_after_head(entry)

-- Consistent Hashing Operations --
FUNCTION HashRing.add_server(server_id):
    servers.add(server_id)
    FOR i FROM 0 TO vnodes_per_server - 1:
        hash_pos = hash(server_id + "#" + i)
        ring[hash_pos] = server_id

FUNCTION HashRing.remove_server(server_id):
    servers.remove(server_id)
    FOR i FROM 0 TO vnodes_per_server - 1:
        hash_pos = hash(server_id + "#" + i)
        DELETE ring[hash_pos]

FUNCTION HashRing.get_server(key):
    IF ring IS EMPTY:
        RETURN NULL
    hash_pos = hash(key)
    // Find the first server position >= hash_pos (clockwise walk)
    server_id = ring.ceiling(hash_pos)
    IF server_id IS NULL:
        server_id = ring.first()   // Wrap around the ring
    RETURN server_id

-- Cache-Aside with Stampede Protection --
FUNCTION DistributedCache.get_with_protection(key, fetch_function):
    // L1: Check local hot cache
    local_value = local_cache.get(key)
    IF local_value != CACHE_MISS:
        RETURN local_value

    // L2: Check distributed cache
    server = ring.get_server(key)
    value = connections[server].GET(key)

    IF value != CACHE_MISS:
        local_cache.set(key, value, 2)  // Short TTL for L1
        RETURN value

    // Cache miss: Use lock to prevent stampede
    lock_key = "lock:" + key
    acquired = connections[server].SET(lock_key, "1", NX, EX, 5)

    IF acquired:
        // This request fetches from database
        value = fetch_function(key)
        connections[server].SET(key, value, EX, 300)
        connections[server].DELETE(lock_key)
        local_cache.set(key, value, 2)
        RETURN value
    ELSE:
        // Another request is fetching; wait and retry
        SLEEP(50ms)
        value = connections[server].GET(key)
        IF value != CACHE_MISS:
            RETURN value
        ELSE:
            // Fallback: fetch directly (lock holder may have failed)
            RETURN fetch_function(key)
```

**Node.js Implementation: LRU Cache**

```javascript
// ============================================================
// LRU Cache Implementation
// Uses a doubly-linked list + Map for O(1) get/set/evict
// ============================================================

class LRUNode {
  // Each node holds a key-value pair and pointers to
  // its neighbors in the doubly-linked list.
  constructor(key, value, ttl = 0) {
    this.key = key;             // Cache key, stored so we can
                                // remove from Map during eviction
    this.value = value;         // The cached data
    this.ttl = ttl;             // Time-to-live in milliseconds
    this.createdAt = Date.now(); // Timestamp for TTL calculation
    this.prev = null;           // Previous node (toward head / MRU)
    this.next = null;           // Next node (toward tail / LRU)
  }

  // Returns true if this entry has expired based on its TTL.
  // A TTL of 0 means the entry never expires.
  isExpired() {
    if (this.ttl === 0) return false;
    return Date.now() - this.createdAt > this.ttl;
  }
}

class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;   // Maximum number of entries
    this.map = new Map();       // key -> LRUNode for O(1) lookup
    this.size = 0;              // Current number of entries

    // Sentinel nodes simplify edge cases.
    // head.next is the most recently used real node.
    // tail.prev is the least recently used real node.
    this.head = new LRUNode('HEAD', null);
    this.tail = new LRUNode('TAIL', null);
    this.head.next = this.tail;
    this.tail.prev = this.head;

    // Statistics for monitoring
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  // Retrieves a value from the cache. Returns undefined on miss.
  get(key) {
    const node = this.map.get(key);

    // Key not found in cache
    if (!node) {
      this.misses++;
      return undefined;
    }

    // Key found but TTL has expired: treat as a miss
    // and lazily remove the expired entry.
    if (node.isExpired()) {
      this._removeNode(node);
      this.map.delete(key);
      this.size--;
      this.misses++;
      return undefined;
    }

    // Cache hit: move node to the head (most recently used)
    // so it is the last to be evicted.
    this._removeNode(node);
    this._addToHead(node);
    this.hits++;
    return node.value;
  }

  // Stores a key-value pair in the cache.
  // ttl is in milliseconds; 0 means no expiration.
  set(key, value, ttl = 0) {
    const existing = this.map.get(key);

    if (existing) {
      // Key already exists: update the value, reset TTL,
      // and move to head.
      existing.value = value;
      existing.ttl = ttl;
      existing.createdAt = Date.now();
      this._removeNode(existing);
      this._addToHead(existing);
      return;
    }

    // New key: check if we need to evict
    if (this.size >= this.capacity) {
      // Evict the least recently used entry (tail.prev)
      const lru = this.tail.prev;
      this._removeNode(lru);
      this.map.delete(lru.key);
      this.size--;
      this.evictions++;
    }

    // Create and insert the new node at the head
    const newNode = new LRUNode(key, value, ttl);
    this._addToHead(newNode);
    this.map.set(key, newNode);
    this.size++;
  }

  // Explicitly removes a key from the cache.
  delete(key) {
    const node = this.map.get(key);
    if (node) {
      this._removeNode(node);
      this.map.delete(key);
      this.size--;
      return true;
    }
    return false;
  }

  // Returns cache statistics for monitoring.
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : 'N/A'
    };
  }

  // --- Internal linked list operations ---

  // Removes a node from its current position in the list.
  // O(1) because we have direct prev/next pointers.
  _removeNode(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    node.prev = null;
    node.next = null;
  }

  // Inserts a node right after the head sentinel,
  // making it the most recently used entry.
  _addToHead(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }
}
```

**Node.js Implementation: Consistent Hashing Ring**

```javascript
// ============================================================
// Consistent Hashing Ring
// Maps keys to servers using virtual nodes for even distribution
// ============================================================

const crypto = require('crypto');

class ConsistentHashRing {
  // vnodeCount: number of virtual nodes per physical server.
  // More vnodes = more even distribution but more memory.
  // 150 is a good default for production.
  constructor(vnodeCount = 150) {
    this.vnodeCount = vnodeCount;

    // ring stores [hashPosition, serverId] pairs sorted
    // by hashPosition for efficient binary search.
    this.ring = [];

    // Set of physical server identifiers.
    this.servers = new Set();
  }

  // Computes a 32-bit integer hash for a given string.
  // We use MD5 for speed (cryptographic strength is not needed).
  _hash(value) {
    const hash = crypto.createHash('md5').update(value).digest();
    // Take the first 4 bytes and interpret as unsigned 32-bit int
    return hash.readUInt32BE(0);
  }

  // Adds a physical server to the ring by creating vnodeCount
  // virtual nodes, each at a different position on the ring.
  addServer(serverId) {
    if (this.servers.has(serverId)) return;
    this.servers.add(serverId);

    for (let i = 0; i < this.vnodeCount; i++) {
      // Each virtual node is hashed with a unique suffix
      // to spread positions across the ring.
      const hashPos = this._hash(`${serverId}#${i}`);
      this.ring.push([hashPos, serverId]);
    }

    // Re-sort the ring so binary search works correctly.
    this.ring.sort((a, b) => a[0] - b[0]);
  }

  // Removes a physical server and all its virtual nodes.
  removeServer(serverId) {
    if (!this.servers.has(serverId)) return;
    this.servers.delete(serverId);

    // Filter out all virtual nodes belonging to this server.
    this.ring = this.ring.filter(([, sid]) => sid !== serverId);
  }

  // Given a key, returns the server responsible for it.
  // Walks clockwise from the key's hash position to find
  // the first server on the ring.
  getServer(key) {
    if (this.ring.length === 0) return null;

    const hashPos = this._hash(key);

    // Binary search for the first ring position >= hashPos.
    let low = 0;
    let high = this.ring.length - 1;
    let result = 0;  // Default: wrap around to position 0

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.ring[mid][0] >= hashPos) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return this.ring[result][1];
  }

  // Returns the distribution of keys across servers for
  // a given set of sample keys. Useful for verifying balance.
  getDistribution(sampleKeys) {
    const counts = {};
    for (const server of this.servers) counts[server] = 0;
    for (const key of sampleKeys) {
      const server = this.getServer(key);
      counts[server] = (counts[server] || 0) + 1;
    }
    return counts;
  }
}
```

**Node.js Implementation: Cache-Aside with Stampede Protection**

```javascript
// ============================================================
// Cache-Aside Pattern with Stampede Protection
// Implements locking, stale-while-revalidate, and
// probabilistic early refresh.
// ============================================================

class CacheAside {
  // cacheClient: a client for the distributed cache (e.g., Redis)
  // localCache: an LRUCache instance for L1 hot key caching
  // options: configuration for TTLs, lock timeout, etc.
  constructor(cacheClient, localCache, options = {}) {
    this.cache = cacheClient;
    this.localCache = localCache;
    this.defaultTTL = options.defaultTTL || 300000;     // 5 min in ms
    this.lockTTL = options.lockTTL || 5000;             // 5 sec lock
    this.localTTL = options.localTTL || 2000;           // 2 sec L1
    this.staleGracePeriod = options.staleGracePeriod || 30000; // 30 sec
    this.earlyRefreshBeta = options.earlyRefreshBeta || 1.0;

    // In-flight lock promises to avoid duplicate fetches
    // within the same application instance.
    this.inFlight = new Map();
  }

  // Primary read method. Checks L1, then L2, then database.
  // fetchFn is a function that retrieves the value from the
  // source of truth (database) given a key.
  async get(key, fetchFn) {
    // Layer 1: Check local in-process cache.
    // This absorbs hot key traffic with zero network cost.
    const localValue = this.localCache.get(key);
    if (localValue !== undefined) {
      return localValue;
    }

    // Layer 2: Check distributed cache.
    const cached = await this.cache.get(key);

    if (cached !== null && cached !== undefined) {
      const parsed = JSON.parse(cached);

      // Check if we should probabilistically refresh early.
      // This prevents stampedes by ensuring ~1 request
      // refreshes the value before it expires.
      if (this._shouldEarlyRefresh(parsed)) {
        // Trigger async refresh; do not await it.
        // Current request returns the existing value.
        this._refreshInBackground(key, fetchFn);
      }

      // Populate L1 cache for subsequent requests on
      // the same application server.
      this.localCache.set(key, parsed.value, this.localTTL);
      return parsed.value;
    }

    // Cache miss: fetch from database with stampede protection.
    return this._fetchWithLock(key, fetchFn);
  }

  // Determines whether to proactively refresh a cached entry
  // before it expires. Uses the XFetch algorithm:
  // probability of refresh increases as expiry approaches.
  _shouldEarlyRefresh(entry) {
    const now = Date.now();
    const ttlRemaining = entry.expiresAt - now;
    const totalTTL = entry.expiresAt - entry.storedAt;

    // Only consider early refresh in the last 10% of TTL
    if (ttlRemaining > totalTTL * 0.1) return false;

    // XFetch formula: refetch when random < beta * log(random) * computeTime
    // Simplified: probability increases exponentially as expiry approaches
    const delta = totalTTL - ttlRemaining;
    const probability = (delta / totalTTL) * this.earlyRefreshBeta;
    return Math.random() < probability;
  }

  // Fetches from the database with a distributed lock to
  // prevent multiple concurrent requests from querying the
  // database for the same key (stampede protection).
  async _fetchWithLock(key, fetchFn) {
    // De-duplicate within the same process: if another
    // async operation is already fetching this key, wait
    // for it instead of making a second database call.
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const fetchPromise = this._doFetch(key, fetchFn);
    this.inFlight.set(key, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      // Clean up the in-flight tracker once the fetch
      // completes (whether success or failure).
      this.inFlight.delete(key);
    }
  }

  async _doFetch(key, fetchFn) {
    const lockKey = `lock:${key}`;

    // Attempt to acquire a distributed lock.
    // NX = set only if not exists; PX = expire in milliseconds.
    const acquired = await this.cache.set(
      lockKey, '1', 'NX', 'PX', this.lockTTL
    );

    if (acquired) {
      try {
        // We hold the lock: fetch from database.
        const value = await fetchFn(key);

        // Store in distributed cache with metadata for
        // stale-while-revalidate and early refresh.
        const entry = {
          value: value,
          storedAt: Date.now(),
          expiresAt: Date.now() + this.defaultTTL
        };

        // Set with a TTL that includes the grace period,
        // so stale data is available for stale-while-revalidate.
        const totalTTL = this.defaultTTL + this.staleGracePeriod;
        await this.cache.set(key, JSON.stringify(entry), 'PX', totalTTL);

        // Populate L1 cache.
        this.localCache.set(key, value, this.localTTL);

        return value;
      } finally {
        // Release the lock. Use a Lua script in production
        // to atomically check and delete (avoid deleting
        // someone else's lock if ours expired).
        await this.cache.del(lockKey);
      }
    } else {
      // Another request holds the lock. Wait briefly and
      // retry reading from the cache.
      await new Promise(resolve => setTimeout(resolve, 50));

      const retryValue = await this.cache.get(key);
      if (retryValue !== null) {
        const parsed = JSON.parse(retryValue);
        this.localCache.set(key, parsed.value, this.localTTL);
        return parsed.value;
      }

      // Lock holder may have failed. Fall back to direct fetch.
      // This is a safety net; in production, you might retry
      // multiple times before falling back.
      const value = await fetchFn(key);
      this.localCache.set(key, value, this.localTTL);
      return value;
    }
  }

  // Triggers an async background refresh without blocking
  // the current request. Used by stale-while-revalidate
  // and probabilistic early refresh.
  _refreshInBackground(key, fetchFn) {
    // Fire-and-forget: errors are logged, not propagated.
    this._doFetch(key, fetchFn).catch(err => {
      console.error(`Background refresh failed for key ${key}:`, err);
    });
  }

  // Explicitly invalidates a key from all cache layers.
  // Called after a write to the database.
  async invalidate(key) {
    this.localCache.delete(key);
    await this.cache.del(key);
  }
}
```

**Node.js Implementation: Distributed Cache Client**

```javascript
// ============================================================
// Distributed Cache Client
// Ties together consistent hashing, connection management,
// and the cache-aside pattern into a unified interface.
// ============================================================

class DistributedCacheClient {
  // servers: array of { id, host, port } objects
  // options: capacity, vnodes, TTL settings
  constructor(servers, options = {}) {
    this.ring = new ConsistentHashRing(options.vnodeCount || 150);
    this.connections = new Map();     // serverId -> connection
    this.localCache = new LRUCache(options.localCacheSize || 1000);

    // Register all servers on the consistent hashing ring
    // and establish connections.
    for (const server of servers) {
      this.ring.addServer(server.id);
      // In production, this would be a Redis/Memcached client connection.
      // Here we simulate with an in-memory LRU cache per "server".
      this.connections.set(server.id, new LRUCache(
        options.perServerCapacity || 100000
      ));
    }

    // Monitoring: track operations per server for load analysis
    this.serverOps = {};
    for (const server of servers) {
      this.serverOps[server.id] = { gets: 0, sets: 0, misses: 0 };
    }
  }

  // Routes a GET request to the correct server based on
  // consistent hashing of the key.
  get(key) {
    // L1: local cache check (no network hop)
    const local = this.localCache.get(key);
    if (local !== undefined) return local;

    // Determine which server owns this key
    const serverId = this.ring.getServer(key);
    if (!serverId) return undefined;

    const server = this.connections.get(serverId);
    this.serverOps[serverId].gets++;

    const value = server.get(key);
    if (value !== undefined) {
      // Populate L1 for subsequent reads
      this.localCache.set(key, value, 2000);
      return value;
    }

    this.serverOps[serverId].misses++;
    return undefined;
  }

  // Routes a SET request to the correct server.
  set(key, value, ttl = 300000) {
    const serverId = this.ring.getServer(key);
    if (!serverId) return false;

    const server = this.connections.get(serverId);
    server.set(key, value, ttl);
    this.serverOps[serverId].sets++;

    // Also update L1 so the writing process sees its own write
    this.localCache.set(key, value, 2000);
    return true;
  }

  // Routes a DELETE request to the correct server.
  // Also invalidates L1 to prevent serving stale data.
  delete(key) {
    const serverId = this.ring.getServer(key);
    if (!serverId) return false;

    const server = this.connections.get(serverId);
    server.delete(key);
    this.localCache.delete(key);
    return true;
  }

  // Batch GET: groups keys by target server and fetches
  // in parallel. This is the MGET optimization.
  mget(keys) {
    const results = {};

    // Group keys by their target server
    const serverGroups = {};
    for (const key of keys) {
      const serverId = this.ring.getServer(key);
      if (!serverGroups[serverId]) serverGroups[serverId] = [];
      serverGroups[serverId].push(key);
    }

    // Fetch from each server (in production, these would
    // be parallel network requests using Promise.all)
    for (const [serverId, serverKeys] of Object.entries(serverGroups)) {
      const server = this.connections.get(serverId);
      for (const key of serverKeys) {
        results[key] = server.get(key);
        this.serverOps[serverId].gets++;
      }
    }

    return results;
  }

  // Adds a new server to the cluster. In a real system,
  // this would trigger key migration for affected hash ranges.
  addServer(server) {
    this.ring.addServer(server.id);
    this.connections.set(server.id, new LRUCache(100000));
    this.serverOps[server.id] = { gets: 0, sets: 0, misses: 0 };
    // Note: keys that now map to the new server will experience
    // cache misses until they are re-cached. This is expected
    // behavior with consistent hashing.
  }

  // Removes a server from the cluster. Its keys will be
  // remapped to successor nodes on the ring.
  removeServer(serverId) {
    this.ring.removeServer(serverId);
    this.connections.delete(serverId);
    delete this.serverOps[serverId];
    // Keys that were on the removed server will miss and
    // be re-cached on their new owner.
  }

  // Returns per-server statistics for monitoring dashboards.
  getClusterStats() {
    const stats = {};
    for (const [serverId, conn] of this.connections) {
      stats[serverId] = {
        ...conn.getStats(),
        operations: this.serverOps[serverId]
      };
    }
    stats.localCache = this.localCache.getStats();
    stats.ringSize = this.ring.ring.length;
    stats.serverCount = this.ring.servers.size;
    return stats;
  }
}

// ============================================================
// Usage Example
// ============================================================

// Define three cache servers
const servers = [
  { id: 'cache-server-1', host: '10.0.1.1', port: 6379 },
  { id: 'cache-server-2', host: '10.0.1.2', port: 6379 },
  { id: 'cache-server-3', host: '10.0.1.3', port: 6379 }
];

// Create the distributed cache client
const cache = new DistributedCacheClient(servers, {
  vnodeCount: 150,
  localCacheSize: 500,
  perServerCapacity: 50000
});

// Simulate caching user profiles
for (let i = 0; i < 10000; i++) {
  cache.set(`user:${i}`, { id: i, name: `User ${i}`, active: true }, 300000);
}

// Read back some values
console.log(cache.get('user:42'));
// Output: { id: 42, name: 'User 42', active: true }

// Batch read
const profiles = cache.mget(['user:1', 'user:2', 'user:3']);
console.log(profiles);
// Output: { 'user:1': {...}, 'user:2': {...}, 'user:3': {...} }

// Check how keys are distributed across servers
console.log(cache.getClusterStats());
// Output shows per-server stats, hit rates, and operation counts

// Simulate a server failure: remove server 2
cache.removeServer('cache-server-2');
// Keys that were on server 2 will now map to other servers
// and experience cache misses until re-cached.

// Verify the cache still works
console.log(cache.get('user:42'));
// May return undefined if user:42 was on server 2.
// The application would then fetch from the database and re-cache.
```

The four components shown above form a complete distributed cache system. The LRU cache provides the core eviction mechanism with O(1) operations using the doubly-linked list and hashmap pattern. The consistent hashing ring distributes keys across servers with minimal disruption during topology changes. The cache-aside wrapper adds stampede protection through distributed locking, in-process deduplication, and probabilistic early refresh. The distributed cache client ties everything together with key routing, batch operations, and cluster management. In a production deployment, the simulated in-memory connections would be replaced with actual Redis or Memcached client libraries, and the local cache would run as an in-process layer alongside the network-based distributed cache.

---

### Section 12 — Connection to Next Topic

Designing a distributed cache teaches you the foundational infrastructure patterns that underpin almost every large-scale system: consistent hashing for data distribution, eviction policies for resource management, replication for availability, and tiered architectures for cost-effective performance. These are not abstract concepts — they are the building blocks that production systems at Facebook, Google, Amazon, and Netflix depend on every day. A distributed cache is an infrastructure service, designed to make other systems faster and more resilient.

In Topic 45, we shift from infrastructure to application design with "Design a Chat System." Where a distributed cache is a backend building block, a chat system is a user-facing product with real-time requirements, presence tracking, message ordering guarantees, and delivery semantics (at-least-once, at-most-once, exactly-once). However, the connection between the two topics is direct and deep. A chat system relies heavily on caching: user presence status (online/offline/typing) is cached in-memory because it changes frequently and is queried constantly. Recent message history is cached to avoid database reads on every chat window open. Session data (which WebSocket connection belongs to which user) lives in a distributed cache like Redis. The pub/sub capabilities of Redis (which we touched on in this topic) become a core architectural component for fan-out message delivery in group chats. Even the consistent hashing ring reappears: when a chat system needs to route a message to the correct WebSocket server (the one holding the recipient's connection), it uses a lookup mechanism conceptually identical to the consistent hash ring used for cache routing.

The transition from distributed cache to chat system also illustrates a progression in system design thinking: from stateless request-response patterns (cache GET/SET) to stateful, persistent connections (WebSockets), from simple key-value data models to complex message streams with ordering and delivery guarantees, and from infrastructure concerns (memory management, eviction policies) to product concerns (read receipts, typing indicators, message search). As you work through Topic 45, you will find that the distributed systems foundations built in this topic — partitioning, replication, consistency trade-offs, failure handling — apply directly, but the additional complexity of real-time delivery and user experience requirements adds new dimensions to the design problem.
