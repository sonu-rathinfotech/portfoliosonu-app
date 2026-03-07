# 10 — Real-World Designs Part 2

> From real-time communication to content discovery — five system designs that test your ability to handle bidirectional messaging, multi-channel delivery, massive fan-out, low-latency search, and web-scale data ingestion.

---

<!--
Topic: 45
Title: Design a Chat System (WhatsApp/Slack)
Section: 10 — Real-World Designs Part 2
Track: 80/20 Core
Difficulty: mid-senior
Interview Weight: very-high
Prerequisites: Topics 1-5, 6, 9-10, 15, 25-26
Next Topic: Topic 46 (Design a Notification Service)
Version: 1.0
Last Updated: 2025-05-01
-->

## Topic 45: Design a Chat System (WhatsApp/Slack)

---

### Section 1 — Why This Design?

The history of real-time messaging is the history of the internet becoming personal. In 1996, four Israeli engineers built ICQ ("I Seek You"), a desktop application that let anyone send instant messages to anyone else online. It was raw, primitive, and revolutionary. AOL Instant Messenger followed in 1997, MSN Messenger in 1999, and by the early 2000s, hundreds of millions of people expected real-time text communication as a basic feature of being online. But these early systems were centralized, desktop-bound, and limited to a few hundred thousand concurrent users at best. The architectural problems they faced — connection management, message ordering, presence detection, offline delivery — were already hard. What came next made them orders of magnitude harder.

In 2009, Jan Koum and Brian Acton, both former Yahoo engineers, founded WhatsApp with a deceptively simple premise: replace SMS with internet-based messaging. Their technical choice was deliberate and consequential. They built the server on Erlang, a language designed by Ericsson in the 1980s for telephone switches — systems that needed to handle millions of concurrent connections with extraordinary reliability. A single WhatsApp Erlang server famously handled 2 million TCP connections simultaneously. By 2014, when Facebook acquired WhatsApp for $19 billion, the service had 450 million monthly active users supported by only 32 engineers. That ratio — roughly 14 million users per engineer — remains one of the most remarkable engineering efficiency stories in computing history. The secret was not magic; it was thoughtful architecture layered on top of a runtime designed for exactly this kind of workload.

Meanwhile, Stewart Butterfield was failing at something else entirely. His company, Tiny Speck, was building a multiplayer game called Glitch. The game flopped, but the internal communication tool the team had built to coordinate their work was extraordinary. Butterfield recognized the pivot opportunity, and Slack launched in 2013. Where WhatsApp solved consumer messaging at planetary scale, Slack solved enterprise communication with a fundamentally different architecture: channels instead of contact lists, threading instead of flat chat, deep integrations instead of simplicity, and search as a first-class feature. Discord took yet another path in 2015, optimizing for gaming communities with voice chat, large servers, and roles-based permissions. Telegram, founded by Pavel Durov in 2013, differentiated on speed, encryption, and open APIs.

This design question — "Design a chat system like WhatsApp or Slack" — appears in system design interviews more than almost any other topic. The reason is density. A single chat system touches real-time communication (WebSockets), distributed databases (message storage at scale), presence systems (who is online), fan-out problems (group messages), push notifications (offline delivery), media handling (file and image sharing), end-to-end encryption, message ordering in distributed systems, and horizontal scaling of stateful connections. No other single design question covers this much ground. An interviewer can probe your depth on any of these axes, and your ability to navigate the trade-offs — fan-out on write versus read, SQL versus NoSQL, push versus pull, consistency versus availability — reveals how you think about systems under real constraints.

---

### Section 2 — Requirements Gathering

In any system design interview, the first five minutes determine the trajectory of the entire conversation. Jumping straight into architecture without clarifying requirements is the most common reason candidates receive mediocre scores. For a chat system, the requirement space is vast, so you need to scope it deliberately.

**Functional Requirements**

The core functional requirements for a WhatsApp/Slack-style system are these. First, one-to-one (1:1) messaging: two users can exchange text messages in real time. This is the atomic unit of the system and must work flawlessly before anything else matters. Second, group chat: users can create groups and send messages visible to all members. The scale of groups matters enormously for architecture — WhatsApp caps groups at 1,024 members, while Slack channels can have tens of thousands and Discord servers can have hundreds of thousands. For this design, we will support groups up to 100,000 members, which forces us to confront the fan-out problem head-on. Third, online/offline presence: users can see whether their contacts are currently online, and if not, when they were last active. Fourth, read receipts: senders can see when their message has been delivered to the recipient's device and when it has been read. Fifth, media sharing: users can send images, videos, documents, and voice messages. Sixth, message history: users can scroll back through past conversations, and messages persist across devices.

**Non-Functional Requirements**

The non-functional requirements are where the real engineering challenge lives. Real-time delivery means end-to-end latency under 100 milliseconds for online recipients — from the moment the sender presses send to the moment the message appears on the recipient's screen. Message ordering must be guaranteed within a conversation: if Alice sends "Are you free?" followed by "for dinner tonight?", Bob must see them in that order, even if network conditions cause packets to arrive out of sequence. Offline message delivery must be reliable: if Bob's phone is off when Alice sends a message, that message must be waiting when Bob reconnects, whether that is in five minutes or five days. End-to-end encryption should be an option (WhatsApp uses Signal Protocol by default), but we will design encryption as an optional layer rather than baking it into every component. The system must be highly available — users expect chat to work even when parts of the infrastructure are degraded. Finally, we need horizontal scalability because the user base and message volume will grow continuously.

**Back-of-Envelope Estimation**

Let us ground this design in concrete numbers. Assume 500 million daily active users (DAU). Each user sends an average of 40 messages per day. That gives us:

```
Total messages per day:
  500,000,000 users x 40 messages/user = 20,000,000,000 (20 billion) messages/day

Messages per second:
  20,000,000,000 / 86,400 seconds = ~231,000 messages/second average
  Peak (3x average) = ~700,000 messages/second

Message size:
  Average text message: 100 bytes (content + metadata)
  Daily text storage: 20B x 100 bytes = 2 TB/day
  Annual text storage: 2 TB x 365 = 730 TB/year

Media messages (assume 10% of messages include media):
  2 billion media messages/day
  Average media size: 200 KB (compressed images, short voice messages)
  Daily media storage: 2B x 200 KB = 400 TB/day
  Annual media storage: 400 TB x 365 = 146 PB/year

Concurrent connections:
  If 10% of DAU is online at any given time: 50 million concurrent WebSocket connections
  Peak (20%): 100 million concurrent WebSocket connections

WebSocket server capacity:
  If each server handles 50,000 concurrent connections:
  50,000,000 / 50,000 = 1,000 WebSocket servers (baseline)
  100,000,000 / 50,000 = 2,000 WebSocket servers (peak)

Bandwidth:
  Incoming: 231,000 msg/sec x 100 bytes = ~23 MB/sec (text only, manageable)
  Media bandwidth is orders of magnitude higher and handled separately via CDN
```

These numbers reveal the fundamental architectural pressures. The message volume (20 billion per day) demands a write-optimized datastore. The connection count (50-100 million concurrent) demands a stateful server tier that can scale horizontally. The media volume (400 TB/day) demands a separate object storage pipeline with CDN delivery. And the real-time requirement (sub-100ms) demands persistent connections, not request-response HTTP.

---

### Section 3 — High-Level Architecture

With requirements and scale established, we can sketch the high-level architecture. The system decomposes into several cooperating services, each handling a distinct concern. This separation is not arbitrary — it follows the scaling boundaries we identified in the estimation.

```
+------------------+        +------------------+        +------------------+
|   Mobile/Web     |        |   Mobile/Web     |        |   Mobile/Web     |
|    Client A      |        |    Client B      |        |    Client C      |
+--------+---------+        +--------+---------+        +--------+---------+
         |                           |                           |
         |  WebSocket                |  WebSocket                |  WebSocket
         |                           |                           |
+--------v---------------------------v---------------------------v---------+
|                        Load Balancer (L4/L7)                             |
|                  (sticky sessions by user_id hash)                       |
+--------+---------------------------+---------------------------+---------+
         |                           |                           |
+--------v---------+        +--------v---------+        +--------v---------+
|  WebSocket       |        |  WebSocket       |        |  WebSocket       |
|  Server 1        |        |  Server 2        |        |  Server N        |
|  (Connection     |        |  (Connection     |        |  (Connection     |
|   Manager)       |        |   Manager)       |        |   Manager)       |
+--------+---------+        +--------+---------+        +--------+---------+
         |                           |                           |
         +------------------+--------+---------------------------+
                            |
              +-------------v--------------+
              |     Message Router /        |
              |     Chat Service            |
              +---+--------+--------+------+
                  |        |        |
         +--------+   +---+----+   +--------+
         |             |        |            |
+--------v---+ +------v------+ +---v--------+ +------------------+
| Presence   | | Message     | | Group      | | Push Notification|
| Service    | | Store       | | Service    | | Service          |
+--------+---+ +------+------+ +---+--------+ +--------+---------+
         |            |             |                   |
    +----v----+ +-----v------+ +---v--------+   +------v-------+
    | Redis   | | Cassandra/ | | SQL DB     |   | APNs / FCM   |
    | Cluster | | HBase      | | (Metadata) |   | Gateway      |
    +---------+ +------------+ +------------+   +--------------+
                      |
              +-------v--------+
              | Media Service  |
              | (S3 + CDN)    |
              +----------------+
```

**Connection Flow**: When a user opens the app, the client establishes a WebSocket connection through the load balancer to one of the WebSocket servers. The load balancer uses consistent hashing on user_id to ensure reconnections typically land on the same server (though the system must handle server changes gracefully). The WebSocket server registers this connection in a distributed connection registry (Redis), mapping user_id to server_id. This registry is the backbone of message routing — when a message needs to be delivered to a user, the system looks up which WebSocket server holds their connection.

**Message Delivery Flow**: When Alice sends a message to Bob, the flow proceeds through several stages. Alice's client sends the message over her WebSocket connection to her WebSocket server. The WebSocket server forwards the message to the Chat Service, which performs validation, generates a server-side message ID and timestamp, and persists the message to the message store. The Chat Service then looks up Bob's connection in the registry. If Bob is online, the service routes the message to Bob's WebSocket server, which pushes it down Bob's WebSocket connection. If Bob is offline, the service enqueues the message for push notification delivery and stores it for later retrieval. The Chat Service sends an acknowledgment back to Alice confirming the message was received by the server (single check mark in WhatsApp's model). When Bob's device receives the message, Bob's client sends a delivery receipt back, which the server forwards to Alice (double check mark). When Bob actually reads the message, a read receipt follows the same path (blue double check mark).

This architecture separates concerns along natural scaling boundaries. WebSocket servers scale with concurrent connections. The message store scales with write volume. The presence service scales with heartbeat frequency. The media pipeline scales with upload/download throughput. Each can be independently scaled, deployed, and operated.

---

### Section 4 — Deep Dive: Real-Time Message Delivery

Real-time message delivery is the heart of any chat system, and the engineering complexity here is deeper than it first appears. The goal is deceptively simple: when Alice sends a message, Bob should see it within 100 milliseconds. Achieving this at scale across unreliable networks, with millions of concurrent users, while maintaining ordering guarantees, is one of the harder problems in distributed systems.

**WebSocket Connection Management**

The foundation of real-time delivery is persistent connections. HTTP's request-response model adds unacceptable overhead for chat — each message would require a TCP handshake, TLS negotiation, HTTP header overhead, and a response cycle. WebSockets solve this by upgrading an HTTP connection to a persistent, full-duplex TCP connection. Once established, messages flow in both directions with minimal framing overhead (as little as 2-6 bytes per frame).

Managing millions of WebSocket connections introduces several challenges. First, each connection consumes server memory (roughly 10-50 KB per connection for buffers and state). A server with 64 GB of RAM can reasonably handle 50,000-100,000 concurrent connections. Second, connections are stateful — if a WebSocket server crashes, all users connected to it lose their connections and must reconnect, potentially to a different server. Third, mobile networks are unreliable: connections drop when users enter elevators, switch from WiFi to cellular, or simply when the OS kills background processes to save battery.

To handle this, the system maintains a connection registry in Redis that maps each user_id to the WebSocket server holding their connection. When a user connects, the server writes an entry. When a connection drops, the server removes it. The registry also stores the connection timestamp, which helps detect stale entries if a server crashes without cleanup. A background process periodically scans for stale entries and removes them.

**1:1 Message Flow**

The complete message flow for a 1:1 chat message involves these steps:

```
Alice's Phone          WS Server A       Chat Service       WS Server B       Bob's Phone
     |                      |                 |                  |                  |
     |--- msg (WS frame) ->|                 |                  |                  |
     |                      |--- validate --->|                  |                  |
     |                      |                 |--- persist msg ->|                  |
     |                      |                 |    (Cassandra)   |                  |
     |                      |                 |                  |                  |
     |                      |                 |--- lookup Bob -->|                  |
     |                      |                 |   (Redis registry)|                 |
     |                      |                 |                  |                  |
     |                      |                 |--- route msg --->|                  |
     |                      |                 |                  |--- msg (WS) ---->|
     |                      |<-- server ack --|                  |                  |
     |<-- server ack (tick)-|                 |                  |                  |
     |                      |                 |                  |<-- delivery ack -|
     |                      |                 |<-- delivery ack--|                  |
     |<-- delivered (ticks)-|<-- delivered ---|                  |                  |
     |                      |                 |                  |                  |
```

The critical insight is that persistence happens before delivery. The message is written to the database before the system attempts to deliver it to Bob. This ensures that even if the delivery step fails (Bob disconnects, the routing server crashes), the message is not lost. When Bob reconnects, the system can retrieve undelivered messages from the store.

**Group Message Flow: Fan-Out on Write vs Fan-Out on Read**

Group messaging introduces the fan-out problem, which is one of the most important architectural decisions in chat system design. When Alice sends a message to a group with 500 members, how do those 500 members receive it?

Fan-out on write means the server, upon receiving Alice's group message, immediately creates a copy (or at least a delivery record) for each of the 500 members and pushes the message to all online members. The advantage is that reading is simple and fast — each user just reads from their own inbox. The disadvantage is that a single message to a large group generates enormous write amplification. A message to a 100,000-member group means 100,000 write operations and 100,000 delivery attempts.

Fan-out on read means the server writes the message once to the group's message stream. When each member opens the group, they read from that shared stream. The advantage is that writes are cheap — one write per message regardless of group size. The disadvantage is that reads become more complex because the system must merge messages from all a user's groups into a coherent timeline, and push delivery to offline users becomes harder.

The practical solution is a hybrid approach. For small groups (under 500 members), use fan-out on write. The write amplification is manageable, delivery is fast, and offline queuing is straightforward. For large channels (over 500 members, like Slack channels or Discord servers), use fan-out on read. Members pull messages from the channel's stream when they open it, and only explicit mentions or @channel notifications trigger push delivery. This matches real usage patterns: in a 10,000-member Slack channel, most members are not actively watching the channel at any given moment. Writing 10,000 delivery records for every message would be wasteful.

**Message Ordering**

Ensuring messages appear in the correct order within a conversation is harder than it sounds in a distributed system. Clocks on different servers are not perfectly synchronized (even with NTP, drift can be milliseconds to seconds). If Alice and Bob both send messages at nearly the same time, and their messages hit different servers, the server-assigned timestamps might not reflect the actual send order.

The solution is to use a per-conversation sequence number. Each conversation maintains a monotonically increasing counter. When a message is accepted for a conversation, it is assigned the next sequence number. Clients use these sequence numbers, not timestamps, to order messages within a conversation. The sequence number can be generated by a lightweight coordination service or by using Cassandra's lightweight transactions on a per-conversation counter. For 1:1 chats, the server that processes the message assigns the sequence number. For groups, a single coordinator per group (determined by consistent hashing on group_id) assigns sequence numbers to ensure strict ordering.

Clients also maintain a local sequence tracker. If a client receives message with sequence number 47 but has not yet received 46, it knows there is a gap and can request the missing message from the server. This gap-detection mechanism ensures that even if messages arrive out of order over the network, the client displays them correctly.

---

### Section 5 — Database Design

The choice of database technology for a chat system is not a matter of preference — it is dictated by the access patterns. Chat messages have characteristics that make them a poor fit for traditional relational databases at scale and an excellent fit for certain NoSQL systems.

**Why NoSQL for Messages**

Chat message storage has several defining characteristics. It is extremely write-heavy: at 20 billion messages per day, the system must sustain approximately 230,000 writes per second on average, with peaks of 700,000. Messages are almost always accessed sequentially within a conversation — users scroll through recent messages, rarely querying by arbitrary criteria. Access is heavily time-skewed: recent messages are accessed far more frequently than old ones. And the data model is simple — messages are essentially append-only records with a fixed schema.

These characteristics point directly to a wide-column store like Apache Cassandra or Apache HBase. Cassandra, in particular, excels here because it is designed for high write throughput, supports tunable consistency, distributes data automatically across a cluster, and organizes data on disk in a way that makes sequential reads within a partition very efficient (SSTables sorted by clustering key).

**Message Table Schema (Cassandra)**

```
CREATE TABLE messages (
    conversation_id  UUID,
    message_bucket   INT,          -- time bucket (e.g., YYYYMMDD)
    sequence_num     BIGINT,
    message_id       UUID,
    sender_id        UUID,
    message_type     TEXT,         -- 'text', 'image', 'video', 'file', 'voice'
    content          TEXT,         -- encrypted message body or media URL
    metadata         MAP<TEXT, TEXT>, -- reply_to, forwarded_from, etc.
    created_at       TIMESTAMP,
    PRIMARY KEY ((conversation_id, message_bucket), sequence_num)
) WITH CLUSTERING ORDER BY (sequence_num DESC);
```

The partition key is `(conversation_id, message_bucket)`. This is a critical design decision. If we used only `conversation_id` as the partition key, a long-running active conversation could create an unbounded partition — some group chats have millions of messages spanning years. Unbounded partitions degrade Cassandra's performance because an entire partition must fit within a single node's memory for certain operations. By adding `message_bucket` (a date-based bucket like `20250115`), we bound partition size. Each partition holds one day's messages for one conversation, which is a predictable and manageable size.

The clustering key is `sequence_num` with descending order. This means that within a partition, messages are physically stored in reverse chronological order on disk. When a user opens a conversation and loads the most recent messages (by far the most common read pattern), Cassandra can serve this with a single sequential disk read from the beginning of the partition — no seeking, no filtering, no sorting.

**Message Delivery Status Table**

```
CREATE TABLE message_status (
    message_id    UUID,
    recipient_id  UUID,
    status        TEXT,           -- 'sent', 'delivered', 'read'
    updated_at    TIMESTAMP,
    PRIMARY KEY (message_id, recipient_id)
);
```

This table tracks per-recipient delivery status for each message. For 1:1 chats, there is one row per message. For group chats, there is one row per message per member. This is used to generate read receipts and to know which messages to deliver when an offline user reconnects.

**User and Conversation Metadata (SQL — PostgreSQL)**

While messages belong in a NoSQL store, user profiles and conversation metadata are better served by a relational database. These tables are read-heavy, require complex queries (search by username, list conversations with last message preview), and benefit from ACID transactions (adding/removing group members, updating profiles).

```sql
-- Users table
CREATE TABLE users (
    user_id       UUID PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    display_name  VARCHAR(100),
    avatar_url    TEXT,
    phone_number  VARCHAR(20) UNIQUE,
    created_at    TIMESTAMP DEFAULT NOW(),
    last_seen     TIMESTAMP
);

-- Conversations table
CREATE TABLE conversations (
    conversation_id    UUID PRIMARY KEY,
    type               VARCHAR(10) NOT NULL,  -- '1:1' or 'group'
    name               VARCHAR(200),          -- NULL for 1:1
    created_by         UUID REFERENCES users(user_id),
    created_at         TIMESTAMP DEFAULT NOW(),
    last_message_at    TIMESTAMP,
    last_message_preview TEXT
);

-- Conversation members
CREATE TABLE conversation_members (
    conversation_id  UUID REFERENCES conversations(conversation_id),
    user_id          UUID REFERENCES users(user_id),
    role             VARCHAR(20) DEFAULT 'member',  -- 'admin', 'member'
    joined_at        TIMESTAMP DEFAULT NOW(),
    muted_until      TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id)
);

-- Index for "list all conversations for a user" query
CREATE INDEX idx_member_user ON conversation_members(user_id);
```

The `last_message_at` and `last_message_preview` fields on the conversations table deserve explanation. When a user opens the app, the home screen shows a list of conversations sorted by most recent activity, each with a preview of the last message. If we had to query the message store (Cassandra) for every conversation to get this information, the home screen load would be painfully slow. Instead, we denormalize: every time a message is sent to a conversation, we update these two fields in the conversations table. This makes the home screen query a single SQL query with an ORDER BY on `last_message_at`.

---

### Section 6 — Presence and Online Status

Presence — knowing whether a user is currently online — seems like a simple feature, but at scale it becomes one of the most resource-intensive parts of a chat system. The fundamental challenge is that presence is inherently a real-time, distributed state synchronization problem.

**Heartbeat Mechanism**

The most common approach to presence detection is heartbeating. While a user's app is in the foreground, the client sends a periodic heartbeat to the presence service (typically every 5-30 seconds). The presence service maintains a last-heartbeat timestamp for each user in Redis. If no heartbeat is received within the timeout window (e.g., 30 seconds after the last heartbeat), the user is considered offline, and their `last_seen` timestamp is recorded.

```
Client heartbeat flow:

  Client App (foreground)          Presence Service              Redis
       |                                |                          |
       |--- heartbeat (user_id) ------->|                          |
       |                                |--- SET user:123:hb NOW ->|
       |                                |    EXPIRE 30s            |
       |                                |                          |
       ... (every 5 seconds) ...
       |                                |                          |
       (app backgrounded, no more heartbeats)                      |
       |                                |                          |
       |                                |    (key expires after 30s)|
       |                                |--- user 123 offline ----->|
       |                                |    publish presence event |
```

This approach uses Redis key expiration to automatically detect offline users without any polling or scanning. When the heartbeat key expires, Redis can trigger a notification (via keyspace notifications or a separate monitoring process) that publishes the offline event.

**The Presence Fan-Out Problem**

Here is where presence gets expensive. When Alice comes online, who needs to know? In a simple model, every one of Alice's contacts should be notified. If Alice has 500 contacts and each contact has 500 contacts, and 50 million users are online, the math gets ugly fast. Every status change generates up to 500 notifications. With users going online/offline frequently (mobile apps background and foreground constantly), the system could face millions of presence updates per second, each fanning out to hundreds of recipients.

WhatsApp's approach is pragmatic: presence information is not pushed proactively to all contacts. Instead, when you open a chat with someone, your client subscribes to that person's presence. You only see "online" or "last seen" for the person you are actively chatting with. This reduces the fan-out from hundreds (all contacts) to typically 1-3 (open chat windows). This is a pub/sub model where subscriptions are created on-demand and expire when the chat window is closed.

Slack takes a different approach because its use case is different. In Slack, you see presence indicators for an entire channel sidebar — dozens or hundreds of users. Slack uses a tiered system: for small workspaces, presence is pushed to all members. For large workspaces, presence updates are batched and delivered at lower frequency (every 30-60 seconds rather than in real time). Users in the active viewport get real-time updates; users scrolled out of view get lazy-loaded presence when they scroll into view.

**Optimization Strategies**

Several optimizations make presence manageable at scale. First, debounce status changes: if a user's connection drops and reconnects within 10 seconds, do not publish an offline-then-online event — it just creates noise. Use a grace period before declaring a user offline. Second, tier your fan-out: only push real-time presence to users who are actively viewing a chat with the target user. For contact list views, batch presence queries on a timer (every 30 seconds, query presence for all visible contacts). Third, use a pub/sub system (Redis Pub/Sub or a dedicated service) so that presence events are only delivered to interested subscribers, not broadcast globally. Fourth, for large groups, do not attempt to show individual presence — show aggregate statistics instead ("247 members online") computed lazily.

---

### Section 7 — Group Chat Challenges

Group chat is where the architectural complexity of a messaging system multiplies. A 1:1 chat involves exactly two participants with relatively predictable behavior. A group chat involves N participants, where N can range from 3 to 100,000, and the behavior patterns, consistency requirements, and performance characteristics change dramatically across that range.

**Small Groups vs Large Channels**

The architecture for a 10-person family group chat is fundamentally different from a 50,000-member announcement channel. Small groups (under 500 members) behave like multiplexed 1:1 chats. Every message is immediately relevant to every member. Read receipts for every member are feasible and expected. Presence information for all members is manageable. Fan-out on write makes sense because the write amplification is bounded and the benefit (instant delivery to all members) is worth the cost. WhatsApp's group model is optimized for this use case: groups are capped at 1,024 members, every message fans out to every member, and the experience feels like a real-time conversation.

Large channels (500+ members) behave more like broadcast streams. Most members are passive readers. The message rate can be very high (thousands of messages per day in active Slack channels), but most members are not watching the channel in real time. Read receipts per member would be impractical and meaningless — nobody needs to know that 47,382 of 50,000 members have read a particular message. Fan-out on read is the right strategy here: the message is written once to the channel's message stream, and members read from that stream when they choose to view the channel. Only @mentions and explicit notification settings trigger push delivery to individual members.

**Member List Management**

Managing group membership involves operations that must be consistent. When a user is added to a group, they should see group history from the point they joined (or a configured amount of prior history). When a user is removed, they should stop receiving new messages immediately. These operations require coordination between the SQL metadata store (which tracks membership) and the real-time delivery system (which routes messages). A membership change event must be published to all WebSocket servers so that the routing logic is updated in real time. If Alice is removed from a group while a message is in-flight, the system must handle the race condition gracefully — either delivering the message (since Alice was a member when it was sent) or dropping it (since Alice is no longer a member when it would be delivered). The simpler approach is to check membership at delivery time and drop messages to non-members.

**Message Threading**

Slack introduced message threading as a solution to the chaos of flat chat in active channels. Without threading, a channel with 50 active users becomes an incomprehensible interleaving of multiple simultaneous conversations. Threads allow users to reply to a specific message, creating a sub-conversation that does not clutter the main channel.

Threading changes the data model. Each message now has an optional `thread_id` field pointing to the root message of the thread. The message store must support two access patterns: "get all messages in a channel" (the main timeline) and "get all replies to a specific message" (thread view). In Cassandra, this means either a separate table for thread replies or a secondary index on `thread_id`. A separate table is generally better for performance:

```
CREATE TABLE thread_replies (
    thread_root_id   UUID,
    sequence_num     BIGINT,
    message_id       UUID,
    sender_id        UUID,
    content          TEXT,
    created_at       TIMESTAMP,
    PRIMARY KEY (thread_root_id, sequence_num)
) WITH CLUSTERING ORDER BY (sequence_num ASC);
```

Threading also complicates notifications. When someone replies in a thread, who gets notified? Slack's model is that the thread creator and all participants in the thread (anyone who has replied) get notifications. Users can also explicitly follow or unfollow a thread. This per-thread notification preference must be stored and consulted for every thread reply.

**Mention and Notification Preferences**

In large channels, granular notification control is essential. Users need to choose between being notified on every message, only on mentions, only on @channel/@here mentions, or never. These preferences are per-user-per-channel and stored in the conversation_members table. The notification evaluation logic runs in the Chat Service: when a message is sent to a large channel, the service parses the message for @mentions, checks each mentioned user's notification preferences, and triggers push notifications only for users who should receive them. The message itself is available for anyone who opens the channel, but the push notification is selective.

---

### Section 8 — Media and File Sharing

Text messages are tiny — 100 bytes on average. Media messages are enormous by comparison — a compressed photo is 100-500 KB, a short video can be 5-50 MB, and documents can be even larger. Handling media requires a completely separate pipeline from text message delivery, because the storage requirements, delivery mechanisms, and processing needs are fundamentally different.

**Upload Flow**

The media upload flow is designed to keep large binary payloads off the chat service and WebSocket servers entirely. Here is the complete flow:

```
Client                API Gateway        Media Service         S3             Chat Service
  |                       |                   |                 |                  |
  |-- upload request ---->|                   |                 |                  |
  |   (media metadata)    |--- get pre- ---->|                 |                  |
  |                       |   signed URL      |                 |                  |
  |                       |<-- pre-signed ----|                 |                  |
  |                       |    upload URL     |                 |                  |
  |<-- pre-signed URL ----|                   |                 |                  |
  |                       |                   |                 |                  |
  |-- direct upload (PUT) ---------------------------------->|                  |
  |   (binary data to S3) |                   |                 |                  |
  |<-- upload complete ---- ----------------------------------|                  |
  |                       |                   |                 |                  |
  |-- send message ------>|                   |                 |                  |
  |   (media_url, type,   |                   |                 |                  |
  |    thumbnail)         |---------------------------------------------->|      |
  |                       |                   |                 |         |      |
  |                       |                   |<-- generate ----|         |      |
  |                       |                   |   thumbnail     |         |      |
  |                       |                   |--- store ------>|         |      |
  |                       |                   |   thumbnail     |         |      |
  |                       |                   |                 |   (deliver msg  |
  |                       |                   |                 |    with media   |
  |                       |                   |                 |    URL to       |
  |                       |                   |                 |    recipients)  |
```

The key insight is the use of pre-signed URLs. Instead of routing the binary upload through the chat service (which would consume bandwidth and memory on application servers that should be handling message routing), the client uploads directly to S3 using a time-limited, pre-signed URL generated by the media service. The application servers never touch the binary data. This is critical for cost and performance: a 10 MB video upload would tie up a WebSocket connection's bandwidth and server memory if routed through the chat server, but with pre-signed URLs, the upload goes directly to S3's infrastructure, which is purpose-built for high-throughput binary uploads.

**Compression and Transcoding**

After upload, the media service processes the file asynchronously. Images are compressed to a target quality level and resized to multiple resolutions (thumbnail, standard, full). Videos are transcoded to a standard format (H.264/MP4) at multiple bitrates for adaptive streaming. Voice messages are transcoded to a compact codec (Opus at 16-32 kbps). This processing happens via a worker queue (SQS + Lambda or a dedicated worker pool) so that it does not block the message delivery pipeline.

Thumbnails are generated synchronously or semi-synchronously for images, because the chat message should include a thumbnail that recipients can see immediately while the full image loads. For video, a thumbnail is extracted from the first frame. These thumbnails are stored in S3 and their URLs are included in the chat message metadata, so the recipient's client can display a preview without downloading the full media.

**Progressive Loading and Cost Optimization**

On the recipient side, the client uses progressive loading: display the thumbnail immediately (a few KB), then download the full-resolution image or video only when the user taps on it. This dramatically reduces bandwidth consumption, especially for users on metered mobile connections. WhatsApp takes this further with automatic download settings — users can configure whether media is auto-downloaded on WiFi, cellular, or never.

Storage cost optimization is critical when dealing with 400 TB of new media per day. Several strategies apply. First, deduplication: if the same image is shared in multiple conversations, store it once and reference it by content hash. Second, tiered storage: after 30 days, move media from S3 Standard to S3 Infrequent Access, and after 1 year, move to Glacier. Third, user-managed storage: WhatsApp allows users to delete media from their device while keeping messages, and Slack's free tier limits total workspace storage to 5 GB. Fourth, compression aggressiveness: WhatsApp compresses images and videos significantly before upload, reducing storage and bandwidth at the cost of some quality.

---

### Section 9 — Trade-Offs and Design Decisions

Every architectural choice in a chat system is a trade-off. In a design interview, demonstrating that you understand not just what to choose but why — and what you are giving up — is what separates strong candidates from adequate ones.

**WebSocket vs Long Polling**

WebSockets provide true bidirectional, full-duplex communication over a single TCP connection. The overhead per message is minimal (2-6 bytes of framing). The trade-off is complexity: WebSocket connections are stateful, which complicates load balancing (you need sticky sessions or a connection registry), deployment (rolling deploys must drain connections gracefully), and failure recovery (server crashes disconnect all users). Long polling is simpler operationally — it works over standard HTTP, is stateless per request, and works with any load balancer — but it has higher latency (messages wait until the next poll), higher overhead (HTTP headers on every poll request), and wastes resources when there are no new messages. For a chat system at scale, WebSockets are the clear choice. Long polling is acceptable only as a fallback for environments where WebSockets are blocked (some corporate proxies, older browsers).

**Fan-Out on Write vs Fan-Out on Read**

As discussed in Section 4, this is the central architectural decision for group messaging. Fan-out on write optimizes for read latency (each user reads from their own inbox, which is fast) at the cost of write amplification (one write per group member per message). Fan-out on read optimizes for write efficiency (one write per message regardless of group size) at the cost of read complexity (merging messages from multiple groups) and push delivery difficulty (you must actively check for new messages rather than having them pushed to you). The hybrid approach — fan-out on write for small groups, fan-out on read for large channels — captures the benefits of both while limiting the costs.

**SQL vs NoSQL for Messages**

A relational database like PostgreSQL could handle chat messages at small scale, and its rich query capabilities (full-text search, complex joins, transactions) are appealing. But at 230,000 writes per second, a single PostgreSQL instance is overwhelmed. Sharding PostgreSQL across hundreds of servers is possible but requires manual shard management, cross-shard queries are expensive, and rebalancing shards as data grows is operationally painful. Cassandra handles this naturally: data is automatically distributed across nodes, adding capacity means adding nodes with automatic rebalancing, and the write-optimized storage engine (LSM trees) handles the write volume efficiently. The trade-off is that Cassandra offers limited query flexibility — you can only efficiently query by partition key and clustering key, not by arbitrary columns. For chat messages, where the access pattern is always "get messages for a conversation in time order," this limitation is perfectly acceptable.

**Push vs Pull for Group Messages**

For small groups, push is the right model — the server actively pushes each message to all group members' connections. For large channels, pull is more appropriate — the client periodically checks for new messages or pulls them when the user opens the channel. A pure push model for a 100,000-member channel would mean 100,000 concurrent push operations for every single message, which is wasteful when 95% of members are not looking at the channel. A pure pull model adds latency for small groups where users expect real-time delivery. The hybrid approach matches the delivery model to the group size and member activity.

**End-to-End Encryption Trade-Offs**

End-to-end encryption (E2E), as implemented by WhatsApp using the Signal Protocol, means that the server cannot read message content. Only the sender and recipient(s) hold the decryption keys. This provides strong privacy but imposes significant trade-offs. Server-side search becomes impossible because the server cannot index encrypted content. Spam and abuse detection is harder because the server cannot inspect message content. Multi-device support becomes complex because encryption keys must be synchronized across devices. Group messaging with E2E requires each message to be encrypted separately for each group member's key, adding computational overhead proportional to group size. Backup and recovery is complicated because encrypted messages cannot be restored without the encryption keys. For a design interview, acknowledge these trade-offs and design encryption as an optional layer that can be enabled per conversation.

**Message Ordering Guarantees**

Strict global ordering (total order) across all conversations is unnecessary and prohibitively expensive. What users care about is per-conversation ordering — messages within a single chat appear in the right sequence. This can be achieved with per-conversation sequence numbers as described in Section 4. The trade-off is between strict ordering (which requires coordination and adds latency) and eventual consistency (which is faster but might show messages briefly out of order). For chat, the right balance is strong per-conversation ordering with best-effort cross-conversation ordering. If Alice sends a message in Group A and then immediately sends a message in Group B, it is acceptable if other users see the Group B message before the Group A message — what matters is that messages within Group A and within Group B are each correctly ordered.

---

### Section 10 — Interview Questions

#### Beginner Tier

**Q1: How does a message travel from sender to receiver in a basic chat system?**

A strong answer walks through the end-to-end flow with specificity. The sender's client sends the message over a persistent WebSocket connection to the WebSocket server it is connected to. The WebSocket server forwards the message to the Chat Service, which validates the message (checking that the sender is a member of the conversation, the message is within size limits, and content policies are met). The Chat Service generates a server-side message ID and timestamp, then persists the message to the message store (Cassandra). It then looks up the recipient's connection in the connection registry (Redis) to find which WebSocket server holds the recipient's connection. If the recipient is online, the Chat Service routes the message to that WebSocket server, which pushes it down the recipient's WebSocket connection. The server sends an acknowledgment back to the sender confirming receipt. If the recipient is offline, the Chat Service stores the message for later retrieval and enqueues a push notification through the notification service. When the recipient comes back online and reconnects, the client fetches all undelivered messages from the server.

**Q2: Why do chat systems use WebSockets instead of HTTP for message delivery?**

The answer centers on three factors: latency, efficiency, and bidirectionality. HTTP is a request-response protocol — the client must ask the server for new messages, and the server cannot proactively push data to the client without a pending request. For chat, where messages can arrive at any time and need to be displayed immediately, this model fails. Long polling (where the client sends a request and the server holds it until new data is available) partially solves this but is wasteful — each poll cycle involves full HTTP headers (often 500+ bytes), TCP connection setup, and resource consumption on the server even when there are no messages. WebSockets upgrade an HTTP connection into a persistent, full-duplex TCP connection where both sides can send data at any time with minimal framing overhead. A single WebSocket connection replaces what would otherwise require constant polling. The trade-off is that WebSocket connections are stateful, which makes horizontal scaling more complex, but for chat systems where latency and efficiency are paramount, this trade-off is worth it.

**Q3: How do you handle messages sent to users who are currently offline?**

When the Chat Service determines that a recipient is offline (no entry in the connection registry, or the heartbeat has expired), two things happen. First, the message is persisted to the message store just as it would be for an online user — the message is not lost. Second, a push notification is sent via the push notification service (which interfaces with Apple's APNs for iOS devices and Google's FCM for Android devices) to alert the user that a new message has arrived. When the user opens the app and re-establishes a WebSocket connection, the client sends its last-received sequence number to the server. The server queries the message store for all messages in the user's conversations with sequence numbers greater than the last received, and delivers them in bulk. This "sync" process ensures that no messages are lost during offline periods, whether the user was offline for five minutes or five days.

#### Mid-Level Tier

**Q4: How would you design the message storage schema for a chat system handling 20 billion messages per day?**

At 20 billion messages per day (roughly 230,000 writes per second), a relational database is impractical for message storage. The right choice is a wide-column store like Cassandra, which is optimized for high write throughput with its LSM-tree storage engine. The schema uses a composite partition key of `(conversation_id, time_bucket)` where the time bucket is a date-based value (like YYYYMMDD). This bounds partition size — without the time bucket, a years-old active group chat could create an enormous single partition, degrading performance. The clustering key is `sequence_num DESC` so that the most recent messages (the most common query) are stored first on disk and can be read with a single sequential scan. Messages within a partition are immutable once written — edits and deletions are handled with soft-delete flags or separate edit records. This schema supports the primary access pattern (load recent messages for a conversation) extremely efficiently while distributing data evenly across the cluster.

**Q5: Explain the fan-out problem in group messaging and how you would handle groups of different sizes.**

The fan-out problem is this: when a user sends a message to a group of N members, the system must somehow ensure all N members can access that message. Fan-out on write copies the message (or a delivery pointer) to each member's inbox at write time — one incoming message generates N outgoing writes. Fan-out on read writes the message once to the group's stream and makes each member read from that stream. For small groups (under 500 members), fan-out on write is optimal because the write amplification is bounded and it enables fast reads, simple offline delivery (messages are in each user's inbox), and immediate push notification. For large channels (over 500 members), fan-out on write becomes untenable — a single message to a 100,000-member channel would generate 100,000 writes and delivery attempts. Instead, use fan-out on read: write the message once to the channel's stream, and have clients pull from that stream when they open the channel. For push notifications in large channels, only deliver to users who have explicitly opted into notifications or who are mentioned by name. This hybrid approach means the system has different code paths for small groups and large channels, increasing complexity, but the performance and cost characteristics make it necessary.

**Q6: How does a presence system work, and how do you prevent it from overwhelming the system at scale?**

Presence detection uses a heartbeat mechanism: the client sends a periodic signal (every 5-10 seconds) to the presence service, which records the last heartbeat time in Redis with a TTL (e.g., 30 seconds). If no heartbeat arrives before the TTL expires, the user is considered offline. The scaling challenge comes from presence fan-out — when a user's status changes, who needs to know? A naive approach (notify all contacts) creates O(C) notifications per status change, where C is the number of contacts, and with millions of users going online/offline constantly (especially on mobile where apps background frequently), this generates billions of events per hour. The solution has several layers. First, debounce transitions: do not emit an offline event until the user has been unresponsive for 30+ seconds, absorbing transient disconnections. Second, use a subscription model: do not push presence to all contacts. Instead, only push to users who have an active chat window open with the target user. Third, for contact lists, use a pull model — the client periodically queries presence for visible contacts (every 30-60 seconds), not in real time. Fourth, for large groups, do not show individual presence at all — show aggregate counts instead ("24 online") computed lazily. This combination reduces presence traffic by 90-99% compared to the naive approach.

#### Senior Tier

**Q7: How would you implement end-to-end encryption for group messages while maintaining forward secrecy?**

End-to-end encryption for 1:1 chats is relatively straightforward with the Signal Protocol: each pair of users performs a Diffie-Hellman key exchange to establish a shared secret, and messages are encrypted with symmetric keys derived from that shared secret. Forward secrecy is achieved by ratcheting — deriving new keys from previous keys, so compromising a current key does not reveal past messages. For groups, this becomes significantly more complex. The approach used by Signal and WhatsApp is Sender Keys. Each group member generates a sender key, distributes it to all other group members (encrypted with each member's individual session key), and uses it to encrypt messages to the group. This means a message is encrypted once (not N times), which is efficient. But when a member leaves the group, all sender keys must be rotated to prevent the departed member from decrypting future messages. For large groups, this key rotation is expensive — each remaining member must generate a new sender key and distribute it to all other members. Forward secrecy within the group is maintained by chaining (each sender key derives the next), but adding or removing members forces a full re-key. The trade-off is between security (re-key on every membership change) and performance (batch re-keys or accept a window of vulnerability). In a design interview, you should also note that E2E encryption means the server cannot moderate content, index messages for search, or recover messages if a user loses their device and encryption keys.

**Q8: Design a system that guarantees exactly-once message delivery across network failures, server crashes, and client reconnections.**

True exactly-once delivery is famously impossible in distributed systems (the Two Generals Problem), but we can achieve effectively-once delivery through idempotency and deduplication. The design works as follows. First, the client generates a globally unique message ID (UUID) before sending. This ID is included in the message payload. Second, the server uses this client-generated ID as a deduplication key: if the server receives a message with an ID it has already processed, it acknowledges the duplicate without re-processing. Third, the server persists the message and records it as "processed" atomically (within the same Cassandra write, using the message_id as part of the primary key, which makes duplicate writes idempotent). Fourth, for delivery, the server maintains a per-user delivery cursor — the sequence number of the last message confirmed received by the client. When the client reconnects, it sends its cursor, and the server replays all messages after that cursor. If the client receives a message it has already displayed (because it crashed after displaying but before acknowledging), it silently ignores the duplicate using its local message ID cache. This gives us at-least-once delivery at the network layer with client-side deduplication to achieve effectively-once semantics. The server never considers a message "delivered" until the client explicitly acknowledges it, and the client never displays a message it has already shown.

**Q9: How would you handle a "thundering herd" problem when a popular chat server recovers from a crash and 100,000 users simultaneously try to reconnect?**

When a WebSocket server crashes, all users connected to it (potentially 50,000-100,000) lose their connections simultaneously. All their clients will detect the disconnection and immediately attempt to reconnect. If they all hit the load balancer at the same moment, several bad things happen: the load balancer is overwhelmed with connection attempts, the replacement server(s) cannot handle 100,000 simultaneous WebSocket upgrades, and the message sync queries (each reconnecting client requests missed messages) slam the database simultaneously. The solution is layered. First, client-side exponential backoff with jitter: each client waits a random delay (e.g., 0-5 seconds for first attempt, 0-10 seconds for second, etc.) before reconnecting, spreading the reconnection wave over several seconds. The jitter is critical — without it, exponential backoff just creates synchronized waves at predictable intervals. Second, the load balancer should have connection rate limiting per IP and globally, queuing excess connection attempts rather than rejecting them. Third, the reconnection sync should be lightweight: the client sends only its per-conversation sequence cursors, and the server returns only messages newer than those cursors. If a user has 100 conversations, the sync query should be batched rather than issuing 100 individual queries. Fourth, pre-warm the replacement server before directing traffic to it — have it load the connection registry and warm its caches before accepting connections. Fifth, use multiple smaller servers rather than fewer large ones, so that a single server crash affects fewer users.

---

### Section 11 — Complete Code Example

The following implementation demonstrates a chat server with WebSocket handling, message routing, presence tracking, group message fan-out, and offline message queuing. We present both pseudocode and a working Node.js implementation.

**Pseudocode Overview**

```
PSEUDOCODE: Chat Server Core

// ===== DATA STRUCTURES =====
ConnectionRegistry: Map<UserId, {serverId, socketRef}>
Conversations: Map<ConversationId, {members: Set<UserId>, type: '1:1'|'group'}>
MessageStore: SortedMap<(ConversationId, SequenceNum), Message>
OfflineQueue: Map<UserId, List<Message>>
PresenceStore: Map<UserId, {status: 'online'|'offline', lastSeen: Timestamp}>
SequenceCounters: Map<ConversationId, AtomicInteger>

// ===== CONNECTION HANDLING =====
FUNCTION onClientConnect(socket, userId):
    Authenticate(userId, socket.token)
    ConnectionRegistry.put(userId, {serverId: THIS_SERVER, socket: socket})
    PresenceStore.put(userId, {status: 'online', lastSeen: NOW()})
    PublishPresenceChange(userId, 'online')

    // Deliver queued offline messages
    queuedMessages = OfflineQueue.getAndRemove(userId)
    FOR EACH msg IN queuedMessages:
        socket.send(msg)
    END FOR

FUNCTION onClientDisconnect(userId):
    ConnectionRegistry.remove(userId)
    // Debounce: wait 30 seconds before marking offline
    SCHEDULE_AFTER(30 seconds):
        IF ConnectionRegistry.get(userId) IS NULL:
            PresenceStore.put(userId, {status: 'offline', lastSeen: NOW()})
            PublishPresenceChange(userId, 'offline')
        END IF
    END SCHEDULE

// ===== MESSAGE SENDING =====
FUNCTION onMessageReceived(senderId, conversationId, content, clientMessageId):
    // Deduplication check
    IF MessageStore.existsByClientId(clientMessageId):
        RETURN ACK(duplicate=true)
    END IF

    conversation = Conversations.get(conversationId)
    VALIDATE(senderId IN conversation.members)

    // Assign sequence number
    seqNum = SequenceCounters.get(conversationId).incrementAndGet()

    // Create message object
    message = {
        id: generateUUID(),
        clientMessageId: clientMessageId,
        conversationId: conversationId,
        senderId: senderId,
        content: content,
        sequenceNum: seqNum,
        timestamp: NOW(),
        status: 'sent'
    }

    // Persist first, then deliver
    MessageStore.put((conversationId, seqNum), message)

    // Deliver to all other members
    FOR EACH memberId IN conversation.members:
        IF memberId != senderId:
            DeliverToUser(memberId, message)
        END IF
    END FOR

    RETURN ACK(messageId: message.id, seqNum: seqNum)

// ===== MESSAGE DELIVERY =====
FUNCTION DeliverToUser(userId, message):
    connection = ConnectionRegistry.get(userId)
    IF connection IS NOT NULL:
        // User is online — push via WebSocket
        connection.socket.send(serialize(message))
    ELSE:
        // User is offline — queue and send push notification
        OfflineQueue.append(userId, message)
        PushNotificationService.send(userId, {
            title: message.senderName,
            body: truncate(message.content, 100),
            data: {conversationId: message.conversationId}
        })
    END IF

// ===== GROUP FAN-OUT =====
FUNCTION DeliverGroupMessage(conversation, message, senderId):
    memberCount = conversation.members.size()

    IF memberCount <= 500:
        // Small group: fan-out on write
        FOR EACH memberId IN conversation.members:
            IF memberId != senderId:
                DeliverToUser(memberId, message)
            END IF
        END FOR
    ELSE:
        // Large channel: write once, notify only mentioned users
        ChannelStream.append(conversation.id, message)
        mentionedUsers = ParseMentions(message.content)
        FOR EACH userId IN mentionedUsers:
            PushNotificationService.send(userId, notification)
        END FOR
    END IF
```

**Node.js Implementation**

```javascript
// chat-server.js
// A complete chat server implementation using WebSockets, Redis, and in-memory
// structures for demonstration. In production, replace in-memory stores with
// Cassandra (messages) and PostgreSQL (metadata).

const WebSocket = require('ws');              // Line 1: WebSocket library for persistent connections
const Redis = require('ioredis');             // Line 2: Redis client for connection registry and presence
const { v4: uuidv4 } = require('uuid');      // Line 3: UUID generation for message IDs
const http = require('http');                 // Line 4: HTTP server for WebSocket upgrade

// ==================== CONFIGURATION ====================

const PORT = 8080;                            // Line 7: Server listening port
const SERVER_ID = uuidv4();                   // Line 8: Unique ID for this server instance
const HEARTBEAT_INTERVAL = 10000;             // Line 9: Client heartbeat every 10 seconds
const OFFLINE_GRACE_PERIOD = 30000;           // Line 10: 30s before marking user offline
const MAX_GROUP_FANOUT_SIZE = 500;            // Line 11: Threshold for fan-out strategy switch

// ==================== STORAGE LAYER ====================
// In production, these would be external services (Cassandra, PostgreSQL, Redis cluster).
// Here we use in-memory structures for clarity.

const redis = new Redis();                    // Line 16: Redis connection for registry and presence

const connections = new Map();                // Line 18: Local map of userId -> WebSocket object
const conversations = new Map();             // Line 19: conversationId -> {members, type, name}
const messageStore = new Map();              // Line 20: conversationId -> sorted array of messages
const offlineQueues = new Map();             // Line 21: userId -> array of undelivered messages
const sequenceCounters = new Map();          // Line 22: conversationId -> current sequence number
const processedMessageIds = new Set();       // Line 23: Set of clientMessageIds for deduplication
const offlineTimers = new Map();             // Line 24: userId -> timeout handle for offline debounce

// ==================== HTTP + WEBSOCKET SERVER ====================

const server = http.createServer();           // Line 28: Create base HTTP server
const wss = new WebSocket.Server({ server }); // Line 29: Attach WebSocket server to HTTP server

// ==================== CONNECTION HANDLING ====================

wss.on('connection', (ws, req) => {           // Line 33: Handle new WebSocket connection
    // In production, extract auth token from query string or headers
    // and validate it against your auth service.
    const userId = req.url.split('?userId=')[1]; // Line 36: Extract userId from query param

    if (!userId) {                            // Line 38: Reject unauthenticated connections
        ws.close(4001, 'Authentication required');
        return;
    }

    console.log(`User ${userId} connected`);  // Line 42: Log connection event

    // Register this connection locally and in Redis
    connections.set(userId, ws);               // Line 45: Store socket reference locally
    redis.hset('connections', userId, SERVER_ID); // Line 46: Register in distributed registry

    // Cancel any pending offline timer for this user
    if (offlineTimers.has(userId)) {          // Line 49: Check for pending offline transition
        clearTimeout(offlineTimers.get(userId)); // Line 50: Cancel it — user reconnected in time
        offlineTimers.delete(userId);          // Line 51: Clean up timer reference
    }

    // Mark user as online
    updatePresence(userId, 'online');          // Line 54: Update presence status

    // Deliver any queued offline messages
    deliverOfflineMessages(userId, ws);        // Line 57: Flush offline queue to reconnected user

    // Set up heartbeat monitoring
    ws.isAlive = true;                         // Line 60: Initialize heartbeat flag
    ws.on('pong', () => { ws.isAlive = true; }); // Line 61: Client responded to ping

    // Handle incoming messages from this client
    ws.on('message', (data) => {              // Line 64: Handle all incoming WebSocket messages
        try {
            const payload = JSON.parse(data);  // Line 66: Parse JSON message payload
            handleClientMessage(userId, payload, ws); // Line 67: Route to appropriate handler
        } catch (err) {
            console.error(`Invalid message from ${userId}:`, err.message);
            ws.send(JSON.stringify({           // Line 70: Send error back to client
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    });

    // Handle disconnection
    ws.on('close', () => {                    // Line 77: Handle WebSocket close event
        console.log(`User ${userId} disconnected`);
        connections.delete(userId);            // Line 79: Remove local socket reference
        redis.hdel('connections', userId);     // Line 80: Remove from distributed registry

        // Debounce: wait before marking offline (handles transient disconnects)
        const timer = setTimeout(() => {       // Line 83: Start offline grace period
            updatePresence(userId, 'offline'); // Line 84: Mark offline after grace period
            offlineTimers.delete(userId);      // Line 85: Clean up timer reference
        }, OFFLINE_GRACE_PERIOD);

        offlineTimers.set(userId, timer);      // Line 88: Store timer so reconnect can cancel it
    });
});

// ==================== HEARTBEAT MONITORING ====================
// Periodically ping all connected clients. If a client doesn't respond
// with a pong before the next interval, terminate the connection.

const heartbeatCheck = setInterval(() => {    // Line 95: Run heartbeat check periodically
    wss.clients.forEach((ws) => {             // Line 96: Iterate all connected WebSockets
        if (ws.isAlive === false) {           // Line 97: Client missed last heartbeat
            return ws.terminate();             // Line 98: Force-close dead connection
        }
        ws.isAlive = false;                    // Line 100: Reset flag
        ws.ping();                             // Line 101: Send ping frame to client
    });
}, HEARTBEAT_INTERVAL);

// ==================== MESSAGE HANDLING ====================

function handleClientMessage(senderId, payload, senderSocket) {
    // Line 107: Central message router — dispatches based on message type
    switch (payload.type) {
        case 'send_message':                   // Line 109: User is sending a chat message
            handleSendMessage(senderId, payload, senderSocket);
            break;
        case 'create_group':                   // Line 112: User is creating a new group
            handleCreateGroup(senderId, payload, senderSocket);
            break;
        case 'delivery_ack':                   // Line 115: Client confirms message was displayed
            handleDeliveryAck(senderId, payload);
            break;
        case 'read_receipt':                   // Line 118: Client confirms message was read
            handleReadReceipt(senderId, payload);
            break;
        case 'sync':                           // Line 121: Client requesting missed messages
            handleSync(senderId, payload, senderSocket);
            break;
        default:
            senderSocket.send(JSON.stringify({
                type: 'error',
                message: `Unknown message type: ${payload.type}`
            }));
    }
}

// ==================== SEND MESSAGE ====================

function handleSendMessage(senderId, payload, senderSocket) {
    // Line 133: Handle a user sending a message to a conversation
    const { conversationId, content, clientMessageId, messageType = 'text' } = payload;

    // Step 1: Deduplication — if we have already processed this clientMessageId,
    // acknowledge without reprocessing. This handles network retries.
    if (processedMessageIds.has(clientMessageId)) { // Line 138: Check dedup set
        senderSocket.send(JSON.stringify({     // Line 139: Ack the duplicate
            type: 'message_ack',
            clientMessageId,
            duplicate: true
        }));
        return;                                // Line 144: Do not process again
    }

    // Step 2: Validate that the sender is a member of this conversation
    const conversation = conversations.get(conversationId); // Line 148: Look up conversation
    if (!conversation) {                       // Line 149: Conversation does not exist
        senderSocket.send(JSON.stringify({
            type: 'error',
            message: 'Conversation not found'
        }));
        return;
    }

    if (!conversation.members.has(senderId)) { // Line 156: Sender is not a member
        senderSocket.send(JSON.stringify({
            type: 'error',
            message: 'Not a member of this conversation'
        }));
        return;
    }

    // Step 3: Assign a server-side sequence number for ordering
    const seqNum = getNextSequence(conversationId); // Line 164: Atomic increment

    // Step 4: Create the canonical message object
    const message = {                          // Line 167: Build message record
        id: uuidv4(),                          // Line 168: Server-generated unique ID
        clientMessageId,                       // Line 169: Client-generated ID for dedup
        conversationId,                        // Line 170: Which conversation this belongs to
        senderId,                              // Line 171: Who sent it
        content,                               // Line 172: Message body (text or media URL)
        messageType,                           // Line 173: 'text', 'image', 'video', etc.
        sequenceNum: seqNum,                   // Line 174: Ordering within conversation
        timestamp: Date.now(),                 // Line 175: Server timestamp
        status: 'sent'                         // Line 176: Initial status
    };

    // Step 5: Persist to message store (Cassandra in production)
    persistMessage(conversationId, message);   // Line 179: Write to storage
    processedMessageIds.add(clientMessageId);  // Line 180: Record in dedup set

    // Step 6: Acknowledge to sender (single check mark)
    senderSocket.send(JSON.stringify({         // Line 183: Send ack back to sender
        type: 'message_ack',
        clientMessageId,
        messageId: message.id,
        sequenceNum: seqNum,
        timestamp: message.timestamp
    }));

    // Step 7: Deliver to all other conversation members
    const memberCount = conversation.members.size; // Line 191: Count members

    if (conversation.type === '1:1' || memberCount <= MAX_GROUP_FANOUT_SIZE) {
        // Line 193: Small group or 1:1 — fan-out on write
        fanOutOnWrite(conversation, message, senderId);
    } else {
        // Line 196: Large channel — fan-out on read with selective push
        fanOutOnRead(conversation, message, senderId);
    }
}

// ==================== FAN-OUT STRATEGIES ====================

function fanOutOnWrite(conversation, message, senderId) {
    // Line 203: Deliver message to every member of the conversation (except sender).
    // Used for 1:1 chats and small groups where write amplification is acceptable.
    conversation.members.forEach((memberId) => { // Line 205: Iterate all members
        if (memberId === senderId) return;     // Line 206: Skip the sender

        const memberSocket = connections.get(memberId); // Line 208: Look up local connection

        if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
            // Line 210: Member is online on this server — deliver directly
            memberSocket.send(JSON.stringify({
                type: 'new_message',
                message
            }));
        } else {
            // Line 216: Member is offline or on a different server
            // In production: check Redis registry and route to the correct server.
            // Here: queue for offline delivery.
            queueOfflineMessage(memberId, message); // Line 219: Add to offline queue
            sendPushNotification(memberId, message); // Line 220: Trigger push notification
        }
    });
}

function fanOutOnRead(conversation, message, senderId) {
    // Line 225: For large channels, write the message once to the channel stream.
    // Only actively mentioned users receive push notifications.
    // Other members will see the message when they open the channel.

    // The message is already persisted in the channel's message stream (done in handleSendMessage).
    // Here we only handle push notifications for mentioned users.

    const mentionedUserIds = parseMentions(message.content); // Line 232: Extract @mentions

    mentionedUserIds.forEach((userId) => {     // Line 234: Notify each mentioned user
        if (userId !== senderId && conversation.members.has(userId)) {
            const memberSocket = connections.get(userId);
            if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
                // Line 238: Mentioned user is online — send real-time notification
                memberSocket.send(JSON.stringify({
                    type: 'mention_notification',
                    conversationId: conversation.id,
                    message
                }));
            } else {
                // Line 245: Mentioned user is offline — push notification
                sendPushNotification(userId, message);
            }
        }
    });
}

// ==================== GROUP CREATION ====================

function handleCreateGroup(creatorId, payload, creatorSocket) {
    // Line 253: Create a new group conversation
    const { name, memberIds } = payload;

    const conversationId = uuidv4();           // Line 256: Generate unique conversation ID
    const members = new Set([creatorId, ...memberIds]); // Line 257: Include creator as member

    conversations.set(conversationId, {        // Line 259: Store conversation metadata
        id: conversationId,
        type: 'group',
        name,
        members,
        createdBy: creatorId,
        createdAt: Date.now()
    });

    sequenceCounters.set(conversationId, 0);   // Line 267: Initialize sequence counter

    // Notify all members about the new group
    members.forEach((memberId) => {            // Line 270: Inform all members
        const memberSocket = connections.get(memberId);
        if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
            memberSocket.send(JSON.stringify({  // Line 273: Send group creation event
                type: 'group_created',
                conversationId,
                name,
                members: Array.from(members),
                createdBy: creatorId
            }));
        }
    });

    // Acknowledge to creator
    creatorSocket.send(JSON.stringify({        // Line 282: Confirm group creation
        type: 'group_created_ack',
        conversationId
    }));
}

// ==================== DELIVERY AND READ RECEIPTS ====================

function handleDeliveryAck(userId, payload) {
    // Line 290: Client confirms a message was displayed on their device.
    // Forward the delivery receipt to the original sender.
    const { messageId, conversationId } = payload;

    const message = findMessage(conversationId, messageId); // Line 294: Look up the message
    if (!message) return;

    message.status = 'delivered';              // Line 297: Update message status

    // Notify the original sender
    const senderSocket = connections.get(message.senderId); // Line 300: Find sender's connection
    if (senderSocket && senderSocket.readyState === WebSocket.OPEN) {
        senderSocket.send(JSON.stringify({     // Line 302: Send delivery receipt to sender
            type: 'delivery_receipt',
            messageId,
            conversationId,
            deliveredTo: userId,
            timestamp: Date.now()
        }));
    }
}

function handleReadReceipt(userId, payload) {
    // Line 312: Client confirms user has read a message (blue ticks).
    const { messageId, conversationId } = payload;

    const message = findMessage(conversationId, messageId); // Line 315: Look up the message
    if (!message) return;

    message.status = 'read';                   // Line 318: Update message status

    // Notify the original sender
    const senderSocket = connections.get(message.senderId); // Line 321: Find sender's connection
    if (senderSocket && senderSocket.readyState === WebSocket.OPEN) {
        senderSocket.send(JSON.stringify({     // Line 323: Send read receipt to sender
            type: 'read_receipt',
            messageId,
            conversationId,
            readBy: userId,
            timestamp: Date.now()
        }));
    }
}

// ==================== MESSAGE SYNC ====================

function handleSync(userId, payload, userSocket) {
    // Line 334: When a user reconnects, they send their last known sequence number
    // per conversation. The server returns all newer messages.
    const { cursors } = payload;               // Line 337: {conversationId: lastSeqNum}

    Object.entries(cursors).forEach(([convId, lastSeqNum]) => { // Line 339: For each conversation
        const messages = getMessagesSince(convId, lastSeqNum); // Line 340: Query messages after cursor

        if (messages.length > 0) {
            userSocket.send(JSON.stringify({    // Line 343: Send batch of missed messages
                type: 'sync_messages',
                conversationId: convId,
                messages
            }));
        }
    });

    userSocket.send(JSON.stringify({           // Line 350: Signal sync completion
        type: 'sync_complete'
    }));
}

// ==================== PRESENCE MANAGEMENT ====================

function updatePresence(userId, status) {
    // Line 357: Update user's presence in Redis and notify subscribers
    const presenceData = {
        status,
        lastSeen: Date.now()
    };

    // Store in Redis with TTL for automatic cleanup
    redis.hset(`presence:${userId}`, 'status', status); // Line 364: Write status
    redis.hset(`presence:${userId}`, 'lastSeen', Date.now()); // Line 365: Write timestamp

    if (status === 'online') {
        redis.expire(`presence:${userId}`, 3600); // Line 368: 1-hour TTL for online users
    }

    // Publish presence change to other servers via Redis Pub/Sub
    redis.publish('presence_updates', JSON.stringify({ // Line 372: Broadcast presence change
        userId,
        ...presenceData
    }));
}

// Subscribe to presence updates from other servers
const presenceSubscriber = new Redis();        // Line 378: Separate Redis connection for sub
presenceSubscriber.subscribe('presence_updates'); // Line 379: Subscribe to presence channel

presenceSubscriber.on('message', (channel, data) => { // Line 381: Handle presence events
    const update = JSON.parse(data);
    // In production: forward to clients who have subscribed to this user's presence
    // (i.e., clients who have an active chat window open with this user)
});

// ==================== HELPER FUNCTIONS ====================

function getNextSequence(conversationId) {
    // Line 389: Atomically increment and return the sequence counter for a conversation.
    // In production, use a distributed counter (Redis INCR or Cassandra LWT).
    const current = sequenceCounters.get(conversationId) || 0;
    const next = current + 1;
    sequenceCounters.set(conversationId, next);
    return next;
}

function persistMessage(conversationId, message) {
    // Line 397: Store a message in the message store.
    // In production: INSERT into Cassandra messages table.
    if (!messageStore.has(conversationId)) {
        messageStore.set(conversationId, []);
    }
    messageStore.get(conversationId).push(message);
}

function findMessage(conversationId, messageId) {
    // Line 405: Find a specific message by ID within a conversation.
    const messages = messageStore.get(conversationId);
    if (!messages) return null;
    return messages.find(m => m.id === messageId);
}

function getMessagesSince(conversationId, lastSeqNum) {
    // Line 412: Return all messages in a conversation with sequence number > lastSeqNum.
    // In production: SELECT * FROM messages WHERE conversation_id = ? AND sequence_num > ?
    const messages = messageStore.get(conversationId) || [];
    return messages.filter(m => m.sequenceNum > lastSeqNum);
}

function queueOfflineMessage(userId, message) {
    // Line 419: Add a message to a user's offline queue for delivery on reconnect.
    if (!offlineQueues.has(userId)) {
        offlineQueues.set(userId, []);
    }
    offlineQueues.get(userId).push(message);
}

function deliverOfflineMessages(userId, socket) {
    // Line 426: Flush all queued messages to a user who just reconnected.
    const queue = offlineQueues.get(userId);
    if (queue && queue.length > 0) {
        socket.send(JSON.stringify({
            type: 'offline_messages',
            messages: queue
        });
        offlineQueues.delete(userId);          // Line 433: Clear the queue after delivery
    }
}

function sendPushNotification(userId, message) {
    // Line 437: Send a push notification via APNs/FCM.
    // In production: enqueue to a notification service (SQS -> Lambda -> APNs/FCM).
    console.log(`[PUSH] Notification to ${userId}: New message from ${message.senderId}`);
}

function parseMentions(content) {
    // Line 443: Extract @mentioned user IDs from message content.
    // Convention: @{userId} in message text.
    const mentionRegex = /@\{([a-f0-9-]+)\}/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push(match[1]);
    }
    return mentions;
}

// ==================== SERVER STARTUP ====================

server.listen(PORT, () => {                   // Line 455: Start the server
    console.log(`Chat server ${SERVER_ID} listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {                  // Line 459: Handle termination signal
    console.log('Shutting down gracefully...');
    clearInterval(heartbeatCheck);             // Line 461: Stop heartbeat checks

    // Close all WebSocket connections with a "going away" status
    wss.clients.forEach((ws) => {              // Line 464: Notify all clients
        ws.close(1001, 'Server shutting down'); // Line 465: 1001 = Going Away
    });

    server.close(() => {                       // Line 467: Stop accepting new connections
        redis.quit();                          // Line 468: Close Redis connection
        presenceSubscriber.quit();             // Line 469: Close subscriber connection
        process.exit(0);                       // Line 470: Exit cleanly
    });
});
```

**Line-by-Line Explanation of Key Design Decisions**

The server starts by establishing a WebSocket server on top of a standard HTTP server (lines 28-29). This is the standard pattern because the WebSocket protocol begins with an HTTP upgrade request — the client sends a regular HTTP request with an `Upgrade: websocket` header, and the server responds with a 101 Switching Protocols to transition the connection to WebSocket.

The connection handling logic (lines 33-89) demonstrates the four critical operations that must happen when a user connects: authentication (line 36, simplified here), registration in both local and distributed connection registries (lines 45-46), presence update (line 54), and offline message delivery (line 57). The order matters — we register the connection before delivering offline messages so that if new messages arrive during offline delivery, they are routed correctly.

The heartbeat mechanism (lines 95-102) uses WebSocket's built-in ping/pong frames. The server sends a ping to every connected client at a regular interval. If the client does not respond with a pong before the next ping, the connection is considered dead and terminated. This catches connections that are technically still open at the TCP level but where the client is unreachable (common with mobile devices that lose network connectivity without a clean TCP close).

The message sending flow (lines 133-199) implements the full pipeline: deduplication check, membership validation, sequence number assignment, persistence, sender acknowledgment, and delivery fan-out. The order is deliberate and important. Persistence (line 179) happens before delivery (lines 193-197) so that messages are never lost even if delivery fails. The sender receives an acknowledgment (line 183) only after persistence, so the sender knows the server has the message. Deduplication (lines 138-144) uses the client-generated message ID to handle network retries — if the client sends the same message twice (because it did not receive the ack due to a network glitch), the server recognizes the duplicate and acknowledges without reprocessing.

The fan-out strategy split (lines 191-198) implements the hybrid approach discussed in Section 4. For small groups and 1:1 chats, every member gets the message pushed to them immediately. For large channels, the message is written once and only mentioned users receive push notifications. This single `if` statement is one of the most consequential architectural decisions in the entire system.

The graceful shutdown handler (lines 459-470) demonstrates proper server lifecycle management. When the server receives a SIGTERM signal (sent by orchestrators like Kubernetes before killing a pod), it stops the heartbeat checker, closes all WebSocket connections with a 1001 "Going Away" status code (which tells clients to reconnect to a different server rather than retrying the same one), stops accepting new connections, closes external resource connections, and exits. This prevents message loss during deployments and scaling events.

---

### Section 12 — Connection to Next Topic

A chat system generates a relentless stream of events that users need to know about: new messages, mentions, reactions, group invitations, read receipts, and presence changes. In our design, we handled notifications as an inline concern — the `sendPushNotification` function (line 437) fires whenever a message cannot be delivered in real time. But this approach has limitations that become apparent as the system grows.

Consider the broader notification landscape. Chat notifications are just one category among many. A user might also receive notifications from email, calendar events, social media activity, security alerts, marketing campaigns, and system updates. Each notification type has different urgency levels, delivery preferences, and formatting requirements. A chat message notification should appear instantly on the user's phone. A marketing email should respect quiet hours. A security alert should bypass all mute settings and reach the user through every available channel.

This is exactly the problem that Topic 46 — Design a Notification Service — addresses. Where our chat system treats push notifications as a fire-and-forget side effect of message delivery, a dedicated notification service treats notification as a first-class domain with its own requirements: template management, delivery channel selection (push, SMS, email, in-app), rate limiting, user preferences, quiet hours, priority levels, batching (aggregate 50 chat notifications into one digest rather than buzzing the user's phone 50 times), and analytics (delivery rates, open rates, engagement).

The chat system's notification needs will become the motivating use case for the notification service design. You will see how the simple `sendPushNotification` call in our chat server evolves into a multi-channel, priority-aware, user-preference-respecting notification infrastructure that serves not just chat but every product surface that needs to communicate with users. The architectural pattern — extracting an inline concern into a dedicated service when the concern's complexity outgrows its host — is one of the most important evolutionary patterns in system design. It is how real systems grow: not by designing everything upfront, but by recognizing when a responsibility has become important enough to deserve its own service, its own team, and its own scaling strategy.

---

---

<!--
Topic: 46
Title: Design a Notification Service
Section: 10 — Real-World Designs Part 2
Track: 80/20 Core
Difficulty: Mid
Interview Weight: High
Prerequisites: Topics 1-3, 6, 10, 25-26
Next Topic: Topic 47 (Design a News Feed/Timeline)
Version: 1.0
Last Updated: 2025-05-01
-->

## Topic 46: Design a Notification Service

---

### Section 1 — Why This Design?

In June 2009, Apple launched the Apple Push Notification Service (APNs) alongside iPhone OS 3.0, and the way software communicated with users changed permanently. Before APNs, mobile applications had no standardized mechanism to reach users when the app was not running. Developers resorted to ugly hacks — background polling that drained batteries, SMS gateways that cost money per message, or simply hoping users would open the app again. APNs introduced a persistent connection between every iPhone and Apple's servers, creating a single pipe through which any application could deliver a small payload to a user's device. Google followed with Cloud to Device Messaging (C2DM) in 2010, which evolved into Google Cloud Messaging (GCM) in 2012 and was finally rebranded as Firebase Cloud Messaging (FCM) in 2016. On the email side, services like SendGrid (founded 2009) and Amazon SES (launched 2011) abstracted away the brutal complexity of deliverability, IP reputation, bounce handling, and spam compliance, allowing any backend service to send millions of emails without operating its own mail infrastructure.

What started as simple alert mechanisms quickly evolved into sophisticated engagement engines. Modern notification services do far more than deliver a message — they decide which channel to use, what time to send, whether the user has already been contacted too many times today, how to personalize the content, and how to track whether the notification achieved its business goal. Companies like Airbnb, Uber, and LinkedIn have dedicated notification platform teams with dozens of engineers. Uber's notification system, for example, handles push, SMS, email, and in-app notifications across riders, drivers, and Uber Eats users in hundreds of cities, each with different regulatory requirements for SMS and different user preferences for contact frequency.

This design problem appears frequently in system design interviews because it is a natural intersection of nearly every major backend concept. You need message queues to decouple producers from delivery. You need templates and personalization for content generation. You need rate limiting to protect both users and third-party provider APIs. You need multi-channel routing with fallback logic. You need delivery tracking and feedback processing. You need scheduling for time-zone-aware delivery. You need preference management so users can opt out of specific notification categories. And you need all of this to work at scale — a mid-size consumer app sends tens of millions of notifications per day, while a company like Facebook sends billions. An interviewer asking you to design a notification service is really asking you to demonstrate breadth across queuing, storage, API design, reliability patterns, and third-party integration, all wrapped in a single coherent system.

---

### Section 2 — Requirements Gathering

**Functional Requirements**

The core functional requirements for a notification service span multiple delivery channels and user-facing features. First, the service must support push notifications to both iOS (via APNs) and Android (via FCM) devices, including the ability to manage device tokens as users install, uninstall, or switch devices. Second, it must support email delivery with rich HTML templates, attachments, and compliance with CAN-SPAM and GDPR unsubscribe requirements. Third, SMS delivery through providers like Twilio or Amazon SNS must be available for transactional messages like OTP codes, delivery confirmations, and security alerts. Fourth, in-app notifications — the bell icon experience — must provide a notification center where users can view, mark as read, and dismiss notifications without relying on external channels.

Beyond raw delivery, the service needs a template engine that separates content from delivery logic, allowing product teams to create and update notification templates without deploying code. User preference management is essential: users must be able to opt in or out of specific notification categories (marketing, social, transactional) and choose their preferred channels per category. Scheduling support is needed so that notifications can be sent at optimal times based on user time zones or explicitly scheduled for a future date and time. Finally, the service should support notification grouping — batching multiple related notifications (e.g., "5 people liked your post") instead of flooding users with individual alerts.

**Non-functional Requirements**

The service must deliver notifications with soft real-time latency — a target of under 30 seconds from trigger to delivery for high-priority notifications, and under 5 minutes for standard notifications. The delivery guarantee should be at-least-once, meaning we accept the possibility of a duplicate notification over the risk of a missed one, though we will add deduplication to minimize duplicates in practice. The system must support high throughput: at minimum 10 million notifications per day, with the architecture designed to scale to hundreds of millions. Availability must be 99.9% or higher — a notification system that goes down during a product launch or security incident is a critical business failure. The system must handle graceful degradation: if one channel (say SMS) is experiencing provider outages, other channels must continue operating normally.

**Back-of-Envelope Estimation**

Let us work through the numbers for a consumer application with 100 million registered users, of which roughly 30 million are daily active users (DAU).

Notification volume: On average, each DAU receives about 3 notifications per day across all channels. That gives us 30M x 3 = 90M notifications/day. However, not all registered users are active, and some notifications target inactive users (re-engagement campaigns). A more realistic total is around 100M notifications/day, or roughly 300M during peak campaign periods.

Throughput: 100M notifications/day = 100,000,000 / 86,400 seconds = ~1,157 notifications/second average. Peak traffic (during campaigns, breaking events, or morning batch sends) can hit 10x the average, so we need to design for ~12,000 notifications/second sustained, with burst capacity to ~50,000/second.

Channel distribution: Typically, push notifications account for about 60% of volume (60M/day), email about 25% (25M/day), in-app notifications about 10% (10M/day), and SMS about 5% (5M/day) due to cost. SMS costs $0.0075 per segment in the US, so 5M SMS/day = $37,500/day or over $1M/month — this is why SMS is reserved for high-value transactional messages.

Storage: Each notification record is approximately 500 bytes (metadata, status, timestamps). At 100M/day, that is 50GB/day of new notification data, or about 1.5TB/month. With a 90-day retention policy for the notification log, we need roughly 4.5TB of hot storage. User preferences for 100M users at ~1KB each = 100GB, which fits comfortably in a relational database.

Device tokens: Each user might have 1-3 devices. 100M users x 2 devices average = 200M device token records at ~200 bytes each = ~40GB.

---

### Section 3 — High-Level Architecture

The notification service follows a pipeline architecture where a notification request flows through several stages: ingestion, validation, enrichment, routing, queuing, delivery, and feedback processing. Each stage is decoupled from the next via message queues, allowing independent scaling and failure isolation.

The flow begins with notification trigger sources. These can be synchronous API calls from internal services (e.g., the order service triggers "Your order has shipped"), event-driven triggers from a message bus (e.g., a Kafka consumer listening for "user_signed_up" events), or scheduled triggers from a cron-based scheduler (e.g., "Send weekly digest every Monday at 9 AM in the user's time zone"). All triggers converge at the Notification API, which serves as the single entry point.

The Notification API performs initial validation — checking that the request includes a valid user ID, notification type, and required template parameters. It then applies rate limiting to prevent any single upstream service from overwhelming the system. Valid requests are written to a persistent store (for auditability) and placed onto a processing queue.

Processing workers consume from this queue and perform the heavy lifting: they look up user preferences to determine which channels the user has enabled for this notification category, render the template with personalized data, resolve device tokens for push notifications, and split the single notification request into per-channel delivery tasks. Each channel-specific task is placed onto a dedicated channel queue — one for push, one for email, one for SMS, and one for in-app.

Per-channel delivery workers consume from their respective queues and handle the actual integration with external providers. Push workers talk to APNs and FCM. Email workers talk to SendGrid or SES. SMS workers talk to Twilio. In-app workers write directly to the notification center database and push real-time updates via WebSocket connections.

Finally, feedback processors handle asynchronous responses from providers — APNs invalid token feedback, email bounce notifications, SMS delivery receipts — and update the notification status accordingly.

```
                         NOTIFICATION SERVICE ARCHITECTURE

  Trigger Sources                    Core Pipeline                      Delivery
  +--------------+
  | Service APIs |--+
  +--------------+  |    +------------------+    +------------------+
                    +--->| Notification API |    | Template Engine  |
  +--------------+  |    | - Validate       |--->| - Render content |
  | Event Bus    |--+    | - Rate limit     |    | - Personalize    |
  | (Kafka)      |  |    | - Persist        |    | - Localize       |
  +--------------+  |    +--------+---------+    +--------+---------+
                    |             |                        |
  +--------------+  |             v                        v
  | Scheduler    |--+    +------------------+    +------------------+
  | (Cron jobs)  |       | Processing Queue |    | Preference Svc   |
  +--------------+       | (Kafka/SQS)     |    | - Channel prefs  |
                         +--------+---------+    | - DND hours      |
                                  |              | - Freq caps      |
                                  v              +------------------+
                         +------------------+
                         | Channel Router   |
                         | - Resolve tokens |
                         | - Split channels |
                         +--+--+--+--+-----+
                            |  |  |  |
               +------------+  |  |  +------------+
               v               v  v               v
      +--------+--+  +--------++ ++--------+  +--+--------+
      | Push Queue |  |Email Q | |SMS Queue|  |In-App Q   |
      +--------+---+  +---+----+ +----+----+  +----+------+
               |           |          |             |
               v           v          v             v
      +--------+---+ +----+-----+ +--+-------+ +---+------+
      |Push Workers| |Email     | |SMS       | |In-App    |
      |APNs + FCM  | |SendGrid  | |Twilio    | |WebSocket |
      +--------+---+ |SES       | |SNS       | |DB Write  |
               |      +----+-----+ +----+----+ +---+------+
               |           |            |           |
               v           v            v           v
         +-------------------------------------------+
         |         Feedback Processor                 |
         | - Delivery receipts  - Bounce handling     |
         | - Token invalidation - Status updates      |
         +--------------------------------------------+
                              |
                              v
                    +---------+---------+
                    | Notification Log  |
                    | (Cassandra/Dynamo)|
                    +-------------------+
```

This architecture ensures that a failure in one channel (e.g., Twilio is down) does not affect other channels. The per-channel queues act as buffers during provider outages, and messages will be retried when the provider recovers. The separation of the processing stage from the delivery stage means that template rendering and preference lookup happen once, even if the notification is delivered to multiple channels.

---

### Section 4 — Deep Dive: Multi-Channel Delivery

**Push Notifications (APNs and FCM)**

Push notification delivery requires maintaining an integration with two fundamentally different provider systems. Apple's APNs uses HTTP/2 with JWT or certificate-based authentication, accepting JSON payloads up to 4KB. Each request targets a single device token — a hex string that uniquely identifies an app installation on a specific device. FCM uses HTTP v1 API with OAuth 2.0 authentication and accepts payloads up to 4KB as well, targeting registration tokens. Both platforms support notification payloads (which the OS renders automatically) and data payloads (which are delivered silently to the app for custom handling).

Device token management is one of the trickiest aspects of push delivery. Tokens can become invalid when a user uninstalls the app, resets their device, or restores from a backup. APNs provides a feedback service (now integrated into HTTP/2 responses — a 410 status with a timestamp) that tells you a token is no longer valid. FCM returns specific error codes like `UNREGISTERED` or `INVALID_ARGUMENT`. Your system must process these responses and remove or deactivate stale tokens, otherwise you waste resources sending to dead endpoints and risk being throttled by the provider. A common pattern is to maintain a `device_tokens` table with columns for the token value, platform (iOS/Android), app version, last active timestamp, and a status flag. When a token is reported invalid, you mark it as inactive rather than deleting it, in case the feedback was erroneous.

Batching is critical for push delivery throughput. APNs supports multiplexing over HTTP/2, allowing hundreds of concurrent streams on a single connection. FCM offers a batch send API that handles up to 500 messages per request. Your push workers should maintain connection pools to both providers and batch requests to maximize throughput while respecting provider rate limits. APNs does not publish explicit rate limits but will reset connections if you send too aggressively; FCM allows up to 600,000 messages per minute per project.

**Email Delivery**

Email is the most complex channel from a deliverability perspective. Sending an email is technically simple — you submit it via SMTP or an HTTP API to a provider like SendGrid, SES, or Mailgun. Making sure it actually reaches the inbox, rather than the spam folder or a black hole, is where the difficulty lies. Email deliverability depends on IP reputation (your sending IP's history of spam complaints and bounces), domain authentication (SPF, DKIM, and DMARC records), content quality (spam filter scoring), and engagement metrics (how often recipients open and click your emails).

For a notification service at scale, you typically use a dedicated email service provider (ESP) rather than running your own mail servers. The ESP manages IP warmup (gradually increasing send volume on new IPs to build reputation), handles bounce processing (hard bounces from invalid addresses, soft bounces from full mailboxes), processes spam complaints (feedback loops from ISPs), and provides analytics on open rates and click rates. Your notification service integrates with the ESP via their API, passing the rendered HTML content, recipient address, subject line, and metadata. The ESP handles the actual SMTP delivery, retry logic, and feedback processing.

Bounce handling feeds directly back into your notification service. Hard bounces (permanent delivery failures) should trigger immediate deactivation of the email address in your user records. Soft bounces should be retried a few times before the address is marked as problematic. Spam complaints (when a user clicks "Report Spam" in their email client) must be processed immediately — continuing to send to users who have reported you as spam will destroy your sender reputation and affect deliverability for all users.

**SMS Delivery**

SMS is the most expensive channel and the most regulated. In the US alone, the Telephone Consumer Protection Act (TCPA) imposes strict consent requirements and allows statutory damages of $500-$1,500 per unsolicited text message. Internationally, regulations vary by country, and carrier-level filtering adds another layer of complexity. For these reasons, SMS is typically reserved for high-value transactional messages: OTP codes, security alerts, delivery confirmations, and appointment reminders.

Integration with SMS providers like Twilio or Amazon SNS is relatively straightforward — you make an API call with the recipient phone number, message body, and sender ID. The complexity lies in managing costs, handling carrier-specific restrictions (some carriers block messages from short codes, others require pre-registration), dealing with delivery receipts (which are unreliable in SMS — not all carriers report delivery status), and handling international formatting (E.164 format, country code validation). Your notification service should maintain a cost tracking system for SMS to alert operations teams when spending exceeds thresholds.

**In-App Notifications**

In-app notifications are the simplest channel from a delivery perspective because you control the entire stack. There are two components: the notification center (a persistent store of notifications that the user can browse) and real-time delivery (pushing new notifications to currently connected users). The notification center is simply a database query — fetch all notifications for this user, ordered by timestamp, with pagination. Real-time delivery uses WebSocket connections (or Server-Sent Events for simpler implementations) to push new notification data to connected clients immediately.

The in-app channel is unique because it has essentially zero marginal cost, no regulatory constraints, and no third-party dependencies. This makes it the ideal default channel and a natural fallback when other channels fail or are throttled. The trade-off is reach — in-app notifications only work when the user opens your application, so they are insufficient for time-sensitive alerts.

**Channel Priority and Fallback Chains**

A well-designed notification service does not just blast a notification to every channel simultaneously. Instead, it implements a priority and fallback system. For a given notification type, you define a channel priority chain — for example, a shipping update might attempt push first, then fall back to email if the user has no active device tokens, and further fall back to SMS if the email bounces and the notification is urgent. Critical security alerts might fire on all channels simultaneously. Marketing notifications might be limited to push and email only, with no SMS fallback.

The channel router implements this logic by consulting the user's preference settings and the notification type's channel configuration. It generates a list of channel-specific delivery tasks, potentially with dependencies (e.g., "send SMS only if push delivery fails after 5 minutes"). This dependency-based fallback requires tracking delivery status asynchronously and scheduling conditional follow-up deliveries, which adds complexity but significantly improves the user experience by reducing notification spam across channels.

---

### Section 5 — Database Design

The notification service requires several distinct data stores, each optimized for its specific access pattern. Using a single database for everything would create a bottleneck — the notification log alone generates hundreds of millions of records per day, while user preferences need strong consistency and transactional guarantees. Let us walk through each table and the reasoning behind the storage choice.

**User Preferences Table (PostgreSQL / MySQL)**

```
user_preferences
+-------------------+------------+---------------------------------------+
| Column            | Type       | Description                           |
+-------------------+------------+---------------------------------------+
| user_id           | BIGINT PK  | Foreign key to users table            |
| channel_email     | BOOLEAN    | Global email opt-in                   |
| channel_push      | BOOLEAN    | Global push opt-in                    |
| channel_sms       | BOOLEAN    | Global SMS opt-in                     |
| channel_in_app    | BOOLEAN    | Global in-app opt-in                  |
| quiet_hours_start | TIME       | Do-not-disturb start (local time)     |
| quiet_hours_end   | TIME       | Do-not-disturb end (local time)       |
| timezone          | VARCHAR(50)| IANA timezone (e.g., America/New_York)|
| locale            | VARCHAR(10)| Preferred language (e.g., en-US)      |
| updated_at        | TIMESTAMP  | Last preference change                |
+-------------------+------------+---------------------------------------+

category_preferences
+-------------------+------------+---------------------------------------+
| Column            | Type       | Description                           |
+-------------------+------------+---------------------------------------+
| user_id           | BIGINT     | FK to users                           |
| category          | VARCHAR(50)| e.g., marketing, social, transactional|
| channel_email     | BOOLEAN    | Category-specific email opt-in        |
| channel_push      | BOOLEAN    | Category-specific push opt-in         |
| channel_sms       | BOOLEAN    | Category-specific SMS opt-in          |
| PRIMARY KEY       |            | (user_id, category)                   |
+-------------------+------------+---------------------------------------+
```

User preferences are stored in a relational database because they require strong consistency (when a user disables email notifications, that change must be immediately reflected) and the data is relatively small (100M rows at ~1KB each = ~100GB). The two-table design separates global channel preferences from per-category overrides, allowing a simple merge: if a category-specific preference exists, it overrides the global setting.

**Device Tokens Table (PostgreSQL / MySQL)**

```
device_tokens
+-------------------+------------+---------------------------------------+
| Column            | Type       | Description                           |
+-------------------+------------+---------------------------------------+
| id                | BIGINT PK  | Auto-increment                        |
| user_id           | BIGINT     | FK to users (indexed)                 |
| platform          | ENUM       | 'ios', 'android', 'web'              |
| token             | VARCHAR(512)| Device/registration token             |
| app_version       | VARCHAR(20)| App version at registration           |
| is_active         | BOOLEAN    | Whether token is still valid          |
| created_at        | TIMESTAMP  | Token registration time               |
| last_used_at      | TIMESTAMP  | Last successful delivery              |
+-------------------+------------+---------------------------------------+
Index: (user_id, is_active) for fetching active tokens per user
Index: (token) UNIQUE for deduplication and lookup
```

Device tokens live in the same relational database as preferences because they are frequently joined with user data during the routing phase, and the dataset size (~40GB for 200M records) is manageable. The `is_active` flag is critical — rather than deleting tokens that APNs or FCM report as invalid, we deactivate them. This allows us to track churn patterns and reactivate tokens if a user reinstalls.

**Notification Templates Table (PostgreSQL / MySQL)**

```
notification_templates
+-------------------+------------+---------------------------------------+
| Column            | Type       | Description                           |
+-------------------+------------+---------------------------------------+
| template_id       | VARCHAR(100)| e.g., 'order_shipped_v2'             |
| version           | INT        | Template version number               |
| category          | VARCHAR(50)| Notification category                 |
| channel           | ENUM       | 'push', 'email', 'sms', 'in_app'    |
| locale            | VARCHAR(10)| Language code                         |
| subject           | TEXT       | Email subject / push title            |
| body              | TEXT       | Template body with {{variables}}      |
| metadata          | JSONB      | Deep link URL, image URL, actions     |
| is_active         | BOOLEAN    | Whether this version is live          |
| created_at        | TIMESTAMP  | Creation time                         |
| created_by        | VARCHAR(100)| Author for audit                     |
| PRIMARY KEY       |            | (template_id, version, channel, locale)|
+-------------------+------------+---------------------------------------+
```

Templates are stored relationally because they are a small dataset that benefits from transactional updates (you want to atomically activate a new version while deactivating the old one). The composite primary key ensures that each template has per-channel, per-locale, per-version variants. A heavily cached read path (templates change infrequently, so a 5-minute TTL cache eliminates most database reads) keeps this from becoming a bottleneck.

**Notification Log Table (Cassandra / DynamoDB)**

```
notification_log
+-------------------+------------+---------------------------------------+
| Column            | Type       | Description                           |
+-------------------+------------+---------------------------------------+
| notification_id   | UUID       | Unique notification identifier        |
| user_id           | BIGINT     | Recipient user ID                     |
| template_id       | VARCHAR    | Template used                         |
| channel           | VARCHAR    | Delivery channel                      |
| status            | VARCHAR    | pending/sent/delivered/failed/read    |
| priority          | INT        | 1=critical, 2=high, 3=normal, 4=low  |
| rendered_content  | TEXT       | Final rendered notification content   |
| metadata          | MAP        | Tracking data, campaign ID, etc.      |
| created_at        | TIMESTAMP  | When notification was created         |
| sent_at           | TIMESTAMP  | When delivery was attempted           |
| delivered_at      | TIMESTAMP  | When provider confirmed delivery      |
| read_at           | TIMESTAMP  | When user interacted (opened/clicked) |
| error_details     | TEXT       | Error message if failed               |
| idempotency_key   | VARCHAR    | For deduplication                     |
+-------------------+------------+---------------------------------------+
Partition key: user_id
Clustering key: created_at DESC
Secondary index: notification_id (for individual lookups)
```

The notification log is the highest-volume table by far — 100M+ writes per day. This is why it belongs in a wide-column store like Cassandra or a managed NoSQL service like DynamoDB. These databases excel at high write throughput, handle time-series data naturally (the clustering key on `created_at` ensures efficient range queries for "show me the last 50 notifications for this user"), and scale horizontally by adding nodes. The trade-off is eventual consistency, which is acceptable for notification history — a user will not notice if their notification center takes a few hundred milliseconds to reflect the very latest notification.

**Rate Limiting State (Redis)**

```
Rate limit keys in Redis:
  user:{user_id}:daily_count        -> INT (TTL: 24h)
  user:{user_id}:hourly_count       -> INT (TTL: 1h)
  user:{user_id}:category:{cat}:daily -> INT (TTL: 24h)
  service:{service_id}:minute_count -> INT (TTL: 60s)
```

Rate limiting state lives in Redis because it requires extremely fast reads and writes (every notification checks rate limits) and the data is ephemeral (counters naturally expire via TTL). Redis's atomic `INCR` and `EXPIRE` commands make it trivial to implement sliding window or fixed window rate limiting without race conditions.

---

### Section 6 — Template Engine and Personalization

A notification service without a template engine forces every upstream service to construct the full notification content — the subject line, body text, HTML layout, deep link URL, and localized strings — in their own code. This leads to inconsistent formatting, duplicated translation work, and the inability to update notification copy without deploying the triggering service. A centralized template engine solves all of these problems by separating the what (template content managed by product/marketing teams) from the when and who (trigger logic managed by engineering teams).

The template system uses a variable substitution syntax like Handlebars or Mustache. A template might look like: `"Hi {{user.first_name}}, your order #{{order.id}} has shipped! Track it here: {{tracking_url}}"`. When a service triggers a notification, it provides a template identifier and a data payload containing the variable values. The template engine looks up the template, resolves the user's locale to select the correct language variant, and renders the final content by substituting variables. This rendering step also handles conditional logic (e.g., `{{#if order.is_expedited}}Your expedited order{{else}}Your order{{/if}}`) and iteration (e.g., listing multiple items in a cart summary email).

Localization is a first-class concern in the template engine. Each template exists in multiple locale variants, and the engine selects the appropriate variant based on the user's `locale` preference. If a specific locale is not available, the engine falls back through a chain: `es-MX` -> `es` -> `en` (default). This fallback chain ensures that every user receives a notification in the closest available language, even if their specific regional variant has not been translated yet. The translation workflow typically involves exporting template strings to a translation management system (like Crowdin or Phrase), where translators provide localized variants that are then imported back as new template locale entries.

A/B testing notification content is a powerful optimization tool. The template engine can support experiment variants by selecting different template versions based on the user's experiment group assignment. For example, an e-commerce company might test two subject lines for their abandoned cart email: Variant A ("You left something behind!") vs. Variant B ("Complete your purchase and save 10%"). The template engine consults an experiment service to determine which variant each user should receive, and delivery tracking captures which variant was sent so that analytics can compare open rates, click rates, and conversion rates.

Rich media notifications enhance engagement significantly. Push notifications on both iOS and Android support images, videos, and action buttons. The template engine must handle rich media references — an image URL that the push payload includes so the OS can download and display it alongside the notification text. For email, the template engine renders full HTML with inline CSS, responsive layouts, and embedded or linked images. The engine should validate that rich media URLs are accessible and properly sized before delivery to avoid broken notifications.

Deep linking connects a notification to a specific screen within the mobile app or a specific page on the web. The template engine resolves deep link templates like `myapp://orders/{{order.id}}/tracking` into fully qualified deep link URLs. For platforms that require Universal Links (iOS) or App Links (Android), the engine generates the corresponding web URLs that redirect to the app when installed. Deep linking is essential for notification effectiveness — a push notification about a shipped order should take the user directly to the tracking screen, not to the app's home page.

Template versioning ensures that changes to notification content are auditable, reversible, and gradually rolled out. Each template has a version number, and only one version per template/channel/locale combination is marked as active at any time. When a product manager updates a template, a new version is created and can be tested in a staging environment before being activated in production. If a template change causes a spike in unsubscribes or spam complaints, the previous version can be reactivated instantly without a code deployment.

---

### Section 7 — Rate Limiting and User Experience

The most technically perfect notification delivery system is useless — even harmful — if it annoys users into disabling notifications entirely. Research from Localytics shows that users who receive between 2 and 5 push notifications per week have the highest retention rates, while those receiving more than 10 per week have opt-out rates exceeding 40%. Rate limiting in a notification service is therefore not just a technical safeguard against system overload; it is a product feature that directly impacts user retention and engagement.

Per-user rate limits cap the total number of notifications a user can receive within a time window. A typical configuration might allow a maximum of 5 push notifications per day, 2 emails per day (excluding transactional), and 1 SMS per week for marketing messages. These limits are enforced in the channel router: before adding a delivery task to a channel queue, the router checks the user's notification count in Redis. If the limit is reached, the notification is either dropped (for low-priority messages) or downgraded to a less intrusive channel (e.g., switching from push to in-app). Transactional notifications — password resets, OTP codes, security alerts — bypass rate limits entirely because blocking them would break critical user flows.

Notification grouping, also called batching or bundling, collapses multiple related notifications into a single, more informative notification. Instead of sending five separate "X liked your photo" push notifications, the system groups them into "X, Y, and 3 others liked your photo." This requires a grouping buffer: when a notification arrives that matches a groupable pattern, the system holds it in a short buffer (typically 5-15 minutes) before delivery. If additional matching notifications arrive during the buffer period, they are merged. The grouping logic uses a composite key of (user_id, notification_type, grouping_key) to identify notifications that should be batched. The trade-off is latency — grouped notifications are delayed by the buffer duration, which is acceptable for social interactions but not for transactional alerts.

Do-not-disturb (DND) hours prevent notifications from waking users or interrupting them during specified quiet periods. The user's DND preferences (stored in the preferences table) specify a start and end time in their local timezone. The channel router converts these to UTC and checks whether the current time falls within the DND window. If it does, the notification is either held in a delay queue until the DND window ends or silently downgraded to in-app only (which does not trigger a device alert). Critical notifications like security alerts and two-factor authentication codes bypass DND rules.

Frequency capping operates at the notification category level to prevent any single category from dominating the user's attention. For example, a social platform might cap "friend suggestion" notifications at 3 per week and "content recommendation" notifications at 1 per day. These caps are separate from the global per-user rate limit and are checked during the routing phase. Frequency caps help prevent the scenario where an aggressive new feature floods users with notifications and drowns out higher-value transactional alerts.

Unsubscribe handling is both a legal requirement and a user experience imperative. For email, CAN-SPAM requires a visible unsubscribe link in every commercial message, and you must honor unsubscribe requests within 10 business days (in practice, you should honor them immediately). For push notifications, the user can revoke permission at the OS level, and you will learn about it through failed deliveries. For SMS, users can reply "STOP" to opt out, and the SMS provider (e.g., Twilio) automatically handles this and notifies your system via webhook. Your notification service must process all of these opt-out signals and update the user's preferences immediately to prevent further unwanted contact.

Priority levels create a hierarchy that determines how notifications compete for the user's attention. A common four-tier scheme works as follows: Priority 1 (Critical) includes security alerts, account lockouts, and payment failures — these bypass all rate limits and DND rules, and are delivered on all channels simultaneously. Priority 2 (High) includes transactional messages like order confirmations and shipping updates — these bypass marketing rate limits but respect DND. Priority 3 (Normal) includes social interactions like likes, comments, and friend requests — these are subject to rate limiting and grouping. Priority 4 (Low) includes marketing, recommendations, and re-engagement — these are the first to be dropped when rate limits are hit and are always subject to frequency caps.

---

### Section 8 — Reliability and Exactly-Once Delivery

Delivering a notification exactly once is, in the strict distributed systems sense, impossible without a two-phase commit protocol between your system and every third-party provider (APNs, FCM, SendGrid, Twilio), which none of them support. The practical approach is at-least-once delivery with deduplication — you guarantee that every valid notification will be delivered at least once, and you add mechanisms to minimize (but not eliminate) duplicates. A user receiving a duplicate push notification is annoying; a user missing a security alert or OTP code is a business-critical failure. The asymmetry of consequences dictates the at-least-once approach.

The at-least-once guarantee is implemented through persistent queuing and acknowledgment-based processing. When a delivery worker pulls a notification from the channel queue, it does not acknowledge (remove) the message until the provider API confirms acceptance. If the worker crashes before receiving confirmation, the message remains in the queue and will be picked up by another worker. If the provider API times out, the worker retries. The queue is configured with a visibility timeout: if a message is not acknowledged within a specified period (e.g., 60 seconds), it becomes visible again for another worker to claim. This ensures that no notification is lost due to worker failures.

Deduplication prevents the at-least-once guarantee from becoming an at-least-twice problem. Each notification is assigned an idempotency key — typically a hash of (user_id, template_id, trigger_event_id, channel). Before delivering a notification, the delivery worker checks a deduplication store (a Redis set with a 24-hour TTL) for this key. If the key exists, the notification is a duplicate and is skipped. If the key does not exist, the worker adds it to the set and proceeds with delivery. This sliding-window deduplication catches most duplicates caused by queue redelivery, worker restarts, or upstream services that accidentally trigger the same notification twice.

Retry strategies must be tailored per channel because failure modes differ dramatically. For push notifications, a 429 (rate limited) response from APNs or FCM calls for exponential backoff starting at 1 second with jitter, up to a maximum of 5 retries. A 400 (bad request) error indicates a malformed payload and should not be retried — it should be logged as a permanent failure. A 410 (gone) from APNs means the device token is invalid and should trigger token deactivation. For email, the ESP typically handles retries internally, but your system should retry API-level failures (5xx responses, network timeouts) with exponential backoff up to 3 times. For SMS, retries are more conservative because each retry costs money — typically only 1-2 retries for transient errors.

Dead letter queues (DLQs) capture notifications that have exhausted all retry attempts. Rather than discarding these failed notifications, they are moved to a separate queue for manual inspection and debugging. The DLQ serves multiple purposes: it provides visibility into systemic delivery failures (e.g., "we have 50,000 push notifications in the DLQ because our APNs certificate expired"), it allows operators to replay failed notifications after fixing the root cause, and it generates alerts that trigger on-call investigation when the DLQ depth exceeds a threshold.

Delivery status tracking maintains a state machine for each notification: `created -> queued -> sent -> delivered -> read` (with `failed` and `dropped` as terminal states). Transitions are written to the notification log. The "sent" state means the provider API accepted the message. The "delivered" state means the provider confirmed delivery to the device (available for push and SMS but not reliably for email). The "read" state is tracked through open tracking pixels (email), notification interaction callbacks (push), or explicit mark-as-read actions (in-app). This granular status tracking powers analytics dashboards, enables debugging of delivery issues, and supports SLA monitoring.

Feedback loops close the circle between delivery and user data. APNs returns 410 responses for invalid tokens and provides a bulk feedback endpoint for token cleanup. FCM returns specific error codes in its response body. Email providers send bounce notifications (via webhooks or SNS topics) and spam complaints (via feedback loop programs with ISPs). SMS providers send delivery receipts via webhooks. The feedback processor consumes all of these signals, updates token validity, email deliverability scores, and phone number status in the appropriate database tables. Without robust feedback processing, your notification service will degrade over time as it accumulates stale tokens and invalid addresses, wasting resources and damaging sender reputation.

---

### Section 9 — Trade-Offs and Design Decisions

**Push vs. Pull for In-App Notifications**

The notification center (the bell icon) can be implemented as push-based (WebSocket/SSE pushes new notifications in real time) or pull-based (the client polls an API endpoint periodically). Push provides instant updates but requires maintaining persistent connections for all online users, which at 30M DAU could mean 10-20 million concurrent WebSocket connections. Pull is simpler and cheaper but introduces latency proportional to the polling interval. The pragmatic solution is a hybrid: use WebSocket push for users who are currently active on the page, and fall back to polling for inactive tabs or clients that lose their WebSocket connection. This gives real-time feel during active sessions without the infrastructure cost of maintaining connections for every idle client.

**At-Least-Once vs. Exactly-Once Delivery**

As discussed in the reliability section, true exactly-once delivery across third-party providers is impractical. The decision to use at-least-once with deduplication is driven by the asymmetry of failure modes: a missed notification has higher business impact than a duplicate. For extremely sensitive notifications (e.g., payment confirmations or OTP codes), you can add application-level deduplication on the client side — the mobile app ignores a push notification if it has already displayed one with the same idempotency key.

**Real-Time vs. Batched Delivery**

Some notifications benefit from immediate delivery (OTP codes, security alerts), while others benefit from batching (social interaction summaries, daily digests). The architecture supports both through priority levels and scheduling. Critical and high-priority notifications are processed immediately with no intentional delay. Normal and low-priority notifications can be routed through a batching system that accumulates notifications and delivers them at optimal times. The batching decision is made at the template level — the template configuration specifies whether the notification type is "immediate" or "batchable."

**Centralized vs. Per-Service Notification Systems**

Some organizations let each service team build their own notification logic — the orders team sends order emails, the social team sends friend request pushes, etc. This per-service approach gives teams full autonomy but leads to inconsistent user experiences, duplicated infrastructure investment, and the inability to enforce global rate limits. A centralized notification service provides consistency, shared infrastructure, and cross-service rate limiting, but introduces a dependency that all teams must integrate with. The centralized approach is almost always the right choice for companies past the initial startup phase, because the user experience benefits and operational efficiency gains far outweigh the coordination overhead.

**Third-Party Providers vs. Self-Hosted**

For push notifications, you have no choice — APNs and FCM are the only way to deliver push notifications to iOS and Android devices respectively. For email and SMS, you could theoretically run your own SMTP servers or connect directly to carrier gateways. In practice, this is almost never worth it. Running your own email infrastructure means managing IP reputation, deliverability, bounce processing, spam compliance, and scaling across dozens of ISP relationships. ESPs like SendGrid and SES have spent years building this infrastructure and can offer better deliverability at lower cost than a self-hosted solution. The same applies to SMS — Twilio and similar providers aggregate relationships with hundreds of carriers worldwide. Self-hosting makes sense only at extreme scale (billions of emails/month) or when regulatory requirements mandate that message content never leaves your infrastructure.

**Template-Driven vs. Raw Content**

You could allow upstream services to pass fully rendered notification content directly to the notification service, bypassing the template engine entirely. This is useful for edge cases where a service needs complete control over the notification format. However, making raw content the default would undermine the template engine's benefits: consistency, localization, A/B testing, and the ability to update copy without code deployments. The recommended approach is to require templates by default and offer a "raw content" mode as an opt-in escape hatch for services that need it, with appropriate code review and approval gates.

---

### Section 10 — Interview Questions

**Beginner Tier**

*Question 1: How would you design a system that sends push notifications to millions of users when a new feature launches?*

A model answer begins by identifying this as a fan-out problem. The feature launch notification targets a large user segment (potentially all users), so you cannot simply loop through users and call APNs/FCM synchronously — that would take hours and could overload the providers. Instead, you create a notification job that is broken into batches. A batch generator queries the user database to fetch user IDs in pages (e.g., 10,000 users per page), and for each page, it publishes a batch message to a processing queue. Processing workers consume these batches, look up device tokens for each user, render the notification content (which is the same for all users, so caching the rendered template is efficient), and publish individual delivery tasks to the push channel queue. Push delivery workers then send to APNs/FCM, batching requests where possible (FCM supports up to 500 per batch call). The entire fan-out might take 15-30 minutes for 100M users, which is acceptable for a feature announcement. Rate limiting at the provider level is managed by controlling the concurrency of push workers.

*Question 2: How do you handle it when a user has both an iPhone and an Android phone?*

The device tokens table stores multiple tokens per user, each tagged with its platform (iOS or Android). When the channel router generates push delivery tasks, it creates one task per active device token for the user. The push delivery worker inspects the platform field to determine whether to call APNs or FCM. Both devices receive the notification, and the user sees it on whichever device they check first. To avoid redundancy after one device is dismissed, modern implementations use APNs and FCM's silent notification capability to sync dismissal state across devices — when the user dismisses the notification on their iPhone, the app on their Android phone receives a silent push that clears the notification from the Android notification shade.

*Question 3: Why would you use a message queue between the notification API and the delivery workers?*

The message queue serves three critical purposes. First, it decouples the producer (the service triggering the notification) from the consumer (the delivery worker), so the triggering service does not need to wait for delivery to complete — it gets an immediate acknowledgment that the notification has been accepted. Second, the queue acts as a buffer during traffic spikes. If a marketing campaign triggers 10 million notifications simultaneously, the queue absorbs the burst while delivery workers process them at a sustainable rate. Third, the queue provides durability and retry capability. If a delivery worker crashes, the unacknowledged message returns to the queue and is picked up by another worker, ensuring no notification is lost. Without the queue, the triggering service would need to implement its own retry logic and buffer management.

**Mid Tier**

*Question 1: How would you implement notification deduplication at scale?*

Deduplication requires generating a deterministic idempotency key for each notification and checking it against a fast lookup store before delivery. The idempotency key is a hash of the fields that define uniqueness — typically (user_id, template_id, trigger_event_id, channel). For example, the hash of (user_12345, order_shipped, order_67890, push) produces a unique key. Before delivery, the worker performs a Redis `SET key 1 NX EX 86400` operation — this atomically sets the key only if it does not already exist, with a 24-hour expiry. If the SET succeeds (returns 1), the notification is new and should be delivered. If it fails (returns 0), the notification is a duplicate and should be skipped. The 24-hour TTL ensures the deduplication window is long enough to catch retries and upstream duplicate triggers without growing the Redis dataset indefinitely. For higher accuracy, you can also check the notification log in Cassandra, but the Redis check is faster and catches the vast majority of duplicates.

*Question 2: Design the rate limiting system for a notification service that handles both transactional and marketing notifications.*

The rate limiting system operates at multiple levels with different rules for different notification categories. At the global level, each upstream service has an API rate limit (e.g., 1,000 requests/second) to prevent any single service from overwhelming the notification pipeline. At the user level, marketing notifications are capped at a configurable limit per user per day (e.g., 5 push, 2 email, 1 SMS). Transactional notifications (OTP codes, security alerts, order confirmations) bypass user-level marketing caps but have their own abuse-prevention limits (e.g., no more than 10 OTP codes per hour per user to prevent OTP brute-force attacks). Implementation uses Redis with atomic Lua scripts: a single Lua script increments the counter, checks the limit, and returns allow/deny in one round trip, eliminating race conditions. The script also handles the counter expiry logic using TTL. When a notification is rate-limited, the behavior depends on priority: low-priority notifications are silently dropped, normal-priority notifications are queued for delivery in the next time window, and high-priority notifications log a warning but are never dropped.

*Question 3: How do you handle provider outages (e.g., Twilio SMS is down) without losing notifications?*

Provider outages are handled through the queue-based architecture and circuit breaker pattern. When SMS delivery workers start receiving errors from Twilio (5xx responses, connection timeouts), a circuit breaker opens after a configurable number of consecutive failures (e.g., 10 failures in 30 seconds). While the circuit is open, the SMS delivery workers stop pulling from the queue, allowing messages to accumulate safely. The circuit breaker periodically lets through a single "probe" request to check if the provider has recovered. When the probe succeeds, the circuit closes and workers resume normal processing, draining the backlog. The queue's message retention (configured for 24-72 hours) ensures no messages are lost during even extended outages. Additionally, the monitoring system triggers an alert when the circuit opens so that the on-call engineer can assess the situation. For critical notifications (like OTP codes), the channel router can be configured with a fallback chain that automatically routes SMS failures to an alternative provider (e.g., Amazon SNS as a backup for Twilio).

**Senior Tier**

*Question 1: How would you design the notification service to support multi-region deployment with regulatory compliance for data residency (e.g., GDPR)?*

Multi-region deployment requires partitioning the notification pipeline by geographic region so that user data stays within its regulatory jurisdiction. The architecture deploys independent notification service instances in each region (e.g., US-East, EU-West, AP-Southeast). A global routing layer examines the user's region (derived from their account registration data) and routes the notification request to the appropriate regional instance. Within each region, the full pipeline — API, processing queue, template engine, channel queues, delivery workers — runs independently. User preferences, device tokens, and notification logs are stored in region-local databases and never replicated across region boundaries, satisfying data residency requirements. Templates are replicated globally (they contain no user data) so that each region can render content locally. For cross-region notifications (e.g., a US user sends a message to an EU user), the triggering event is published to a global event bus, and the EU regional instance picks it up and handles delivery within the EU region using EU-resident user data. Provider integrations are also region-aware: emails for EU users are sent from EU-based IP addresses to improve deliverability and comply with data transfer restrictions.

*Question 2: Design an analytics and optimization pipeline that uses notification delivery data to improve engagement.*

The analytics pipeline begins with event collection: every notification lifecycle event (created, sent, delivered, opened, clicked, dismissed, unsubscribed) is published to a Kafka topic. A stream processing layer (Flink or Spark Streaming) consumes these events and maintains real-time aggregates — delivery rate, open rate, and click rate per template, channel, user segment, and time window. These aggregates feed a real-time dashboard for operations and product teams. In parallel, the raw events are landed in a data lake (S3 + Parquet) for batch analytics. Machine learning models trained on historical data predict optimal send time per user (based on when they typically engage with notifications), optimal channel per notification type (some users engage more with push while others prefer email), and notification fatigue risk (predicting when a user is about to disable notifications). These predictions are exposed via a low-latency feature store that the channel router consults during the routing phase. The result is a feedback loop: delivery data trains models that improve routing decisions that generate better delivery data. A/B test results are analyzed in this same pipeline, comparing engagement metrics across template variants with statistical significance testing, and automatically promoting winning variants after sufficient sample size.

*Question 3: How would you migrate from a per-service notification system to a centralized notification service without disrupting existing functionality?*

Migration from distributed per-service notification logic to a centralized service requires a careful strangler fig approach. Phase 1 (Shadow Mode): Deploy the centralized notification service alongside existing per-service implementations. Route a copy of every notification trigger to the new service, but mark it as shadow mode — the new service processes the notification through its entire pipeline (validation, template rendering, routing) but does not actually deliver it. Instead, it logs what it would have sent and compares it to what the existing system actually sent. This reveals discrepancies in template rendering, preference handling, or routing logic without any user impact. Phase 2 (Dual Write): For one notification type at a time (starting with the lowest-risk type), switch the delivery to the new centralized service while keeping the old system as a fallback. Monitor delivery rates, latency, and user engagement metrics for regressions. Phase 3 (Full Migration): Once all notification types are migrated and validated, decommission the per-service notification logic. The old templates, preference stores, and delivery code are removed from each service, and the teams update their integration to call the centralized notification API. This migration typically takes 3-6 months at a mid-size company and requires strong coordination between the notification platform team and each service team. Success metrics include maintaining or improving delivery rates, reducing user complaint rates, and enabling new capabilities (like global rate limiting) that were impossible with the distributed approach.

---

### Section 11 — Complete Code Example

The following implementation demonstrates a notification service with multi-channel routing, template rendering, rate limiting, priority queuing, and delivery tracking. We begin with pseudocode to clarify the logic, then provide a complete Node.js implementation.

**Pseudocode**

```
FUNCTION handleNotificationRequest(request):
    // Step 1: Validate the incoming request
    VALIDATE request has (userId, templateId, data, priority)
    IF validation fails:
        RETURN error 400

    // Step 2: Generate idempotency key for deduplication
    idempotencyKey = HASH(userId + templateId + request.eventId + timestamp_bucket)
    IF deduplication_store.EXISTS(idempotencyKey):
        RETURN success (already processed)
    deduplication_store.SET(idempotencyKey, TTL=24h)

    // Step 3: Check service-level rate limit
    IF rate_limiter.isServiceExceeded(request.sourceService):
        RETURN error 429

    // Step 4: Look up user preferences
    preferences = preference_store.GET(userId)
    enabledChannels = RESOLVE_CHANNELS(request.templateId, preferences)

    // Step 5: Check user-level rate limits per channel
    FOR EACH channel IN enabledChannels:
        IF rate_limiter.isUserExceeded(userId, channel, priority):
            REMOVE channel FROM enabledChannels

    // Step 6: Check do-not-disturb
    IF preferences.isDND(currentTime) AND priority < CRITICAL:
        FILTER enabledChannels to only "in_app"

    // Step 7: Render template for each channel
    FOR EACH channel IN enabledChannels:
        template = template_store.GET(templateId, channel, preferences.locale)
        renderedContent = template_engine.RENDER(template, request.data)

        // Step 8: Create delivery task
        deliveryTask = {
            notificationId: UUID(),
            userId: userId,
            channel: channel,
            content: renderedContent,
            priority: priority,
            metadata: request.metadata
        }

        // Step 9: Enqueue to channel-specific priority queue
        channel_queue[channel].ENQUEUE(deliveryTask, priority)

    // Step 10: Log notification creation
    notification_log.WRITE(notificationId, userId, templateId, channels, "created")
    RETURN success with notificationId


FUNCTION deliveryWorker(channel):
    LOOP:
        task = channel_queue[channel].DEQUEUE()

        TRY:
            // Resolve delivery address
            IF channel == "push":
                tokens = device_store.GET_ACTIVE_TOKENS(task.userId)
                FOR EACH token IN tokens:
                    IF token.platform == "ios":
                        result = apns.SEND(token.value, task.content)
                    ELSE:
                        result = fcm.SEND(token.value, task.content)
                    HANDLE_PROVIDER_RESPONSE(result, token)

            ELSE IF channel == "email":
                email = user_store.GET_EMAIL(task.userId)
                result = email_provider.SEND(email, task.content)

            ELSE IF channel == "sms":
                phone = user_store.GET_PHONE(task.userId)
                result = sms_provider.SEND(phone, task.content)

            ELSE IF channel == "in_app":
                notification_center.WRITE(task.userId, task)
                websocket.PUSH_IF_CONNECTED(task.userId, task)

            // Update status
            notification_log.UPDATE(task.notificationId, "sent")
            channel_queue[channel].ACKNOWLEDGE(task)

        CATCH error:
            IF error.isRetryable AND task.retryCount < MAX_RETRIES:
                task.retryCount++
                channel_queue[channel].REQUEUE(task, backoff(task.retryCount))
            ELSE:
                dead_letter_queue.ENQUEUE(task, error)
                notification_log.UPDATE(task.notificationId, "failed", error)
```

**Node.js Implementation**

```javascript
// notification-service.js
// A complete notification service with multi-channel routing, template rendering,
// rate limiting, priority queuing, and delivery tracking.

const crypto = require('crypto');

// ──────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────

const CONFIG = {
  rateLimits: {
    service: { windowMs: 60000, maxRequests: 1000 },     // 1000 req/min per service
    user: {
      push:  { daily: 10, hourly: 5 },                   // per-user push caps
      email: { daily: 3, hourly: 2 },                    // per-user email caps
      sms:   { daily: 2, hourly: 1 },                    // per-user SMS caps
      in_app: { daily: 50, hourly: 20 }                  // per-user in-app caps
    }
  },
  retryPolicy: {
    push:  { maxRetries: 3, baseDelayMs: 1000 },
    email: { maxRetries: 3, baseDelayMs: 2000 },
    sms:   { maxRetries: 2, baseDelayMs: 5000 },
    in_app: { maxRetries: 1, baseDelayMs: 500 }
  },
  priorities: { CRITICAL: 1, HIGH: 2, NORMAL: 3, LOW: 4 },
  deduplication: { windowMs: 86400000 }                   // 24-hour dedup window
};

// ──────────────────────────────────────────────
// IN-MEMORY STORES (Replace with Redis/DB in production)
// ──────────────────────────────────────────────

// Simulates a Redis-backed deduplication store. In production, each key would
// have a TTL of 24 hours. Here we use a Map with manual expiry checks.
class DeduplicationStore {
  constructor() {
    this.store = new Map();                                // key -> expiry timestamp
  }

  // Returns true if this key was already seen (duplicate).
  // Returns false and records the key if it is new.
  checkAndSet(key, ttlMs) {
    const now = Date.now();
    if (this.store.has(key) && this.store.get(key) > now) {
      return true;                                         // duplicate detected
    }
    this.store.set(key, now + ttlMs);                      // record with expiry
    return false;                                          // new notification
  }
}

// Simulates Redis-backed rate limiting using fixed-window counters.
// Each counter is keyed by (entity, window) and auto-expires.
class RateLimiter {
  constructor() {
    this.counters = new Map();                             // key -> { count, expiresAt }
  }

  // Increments the counter for the given key and checks against the limit.
  // Returns true if the limit is exceeded (request should be denied).
  isExceeded(key, limit, windowMs) {
    const now = Date.now();
    const entry = this.counters.get(key);

    if (!entry || entry.expiresAt <= now) {
      // Window has expired or does not exist — start a new window
      this.counters.set(key, { count: 1, expiresAt: now + windowMs });
      return false;                                        // under limit
    }

    entry.count += 1;
    return entry.count > limit;                            // true if over limit
  }

  // Convenience: check service-level rate limit
  isServiceExceeded(serviceId) {
    const { windowMs, maxRequests } = CONFIG.rateLimits.service;
    return this.isExceeded(`svc:${serviceId}`, maxRequests, windowMs);
  }

  // Convenience: check user-level rate limit for a specific channel
  isUserChannelExceeded(userId, channel, priority) {
    // Critical priority bypasses all user rate limits
    if (priority === CONFIG.priorities.CRITICAL) return false;

    const limits = CONFIG.rateLimits.user[channel];
    if (!limits) return false;

    const hourlyExceeded = this.isExceeded(
      `user:${userId}:${channel}:hourly`, limits.hourly, 3600000
    );
    const dailyExceeded = this.isExceeded(
      `user:${userId}:${channel}:daily`, limits.daily, 86400000
    );

    return hourlyExceeded || dailyExceeded;                // deny if either is hit
  }
}

// ──────────────────────────────────────────────
// TEMPLATE ENGINE
// ──────────────────────────────────────────────

// Stores notification templates keyed by (templateId, channel, locale).
// Templates use {{variable}} syntax for substitution.
class TemplateEngine {
  constructor() {
    this.templates = new Map();
  }

  // Register a template for a given ID, channel, and locale.
  register(templateId, channel, locale, template) {
    const key = `${templateId}:${channel}:${locale}`;
    this.templates.set(key, template);
  }

  // Retrieve a template with locale fallback (e.g., es-MX -> es -> en).
  getTemplate(templateId, channel, locale) {
    const localeChain = this._buildFallbackChain(locale);  // ['es-MX','es','en']
    for (const loc of localeChain) {
      const key = `${templateId}:${channel}:${loc}`;
      if (this.templates.has(key)) {
        return this.templates.get(key);
      }
    }
    return null;                                           // no template found
  }

  // Render a template by replacing {{variable}} placeholders with data values.
  render(template, data) {
    if (!template) return null;

    const rendered = {
      ...template,
      // Replace all {{key}} patterns in the subject
      subject: this._interpolate(template.subject || '', data),
      // Replace all {{key}} patterns in the body
      body: this._interpolate(template.body || '', data)
    };
    return rendered;
  }

  // Build locale fallback chain: 'es-MX' -> ['es-MX', 'es', 'en']
  _buildFallbackChain(locale) {
    const chain = [locale];
    if (locale.includes('-')) {
      chain.push(locale.split('-')[0]);                    // language without region
    }
    if (!chain.includes('en')) {
      chain.push('en');                                    // ultimate fallback
    }
    return chain;
  }

  // Replace {{key}} and {{nested.key}} patterns in a string with data values.
  _interpolate(str, data) {
    return str.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = path.split('.').reduce((obj, key) => {
        return obj && obj[key] !== undefined ? obj[key] : null;
      }, data);
      return value !== null ? String(value) : match;       // keep placeholder if missing
    });
  }
}

// ──────────────────────────────────────────────
// PRIORITY QUEUE (per-channel)
// ──────────────────────────────────────────────

// A simple priority queue that dequeues higher-priority (lower number) tasks first.
// In production, this would be a Kafka topic with priority partitions or an SQS
// FIFO queue with message group IDs.
class PriorityQueue {
  constructor(name) {
    this.name = name;
    this.queues = {                                        // separate list per priority
      [CONFIG.priorities.CRITICAL]: [],
      [CONFIG.priorities.HIGH]: [],
      [CONFIG.priorities.NORMAL]: [],
      [CONFIG.priorities.LOW]: []
    };
  }

  // Add a task to the appropriate priority bucket.
  enqueue(task) {
    const priority = task.priority || CONFIG.priorities.NORMAL;
    this.queues[priority].push(task);
  }

  // Remove and return the highest-priority task.
  dequeue() {
    for (const priority of [1, 2, 3, 4]) {                // check critical first
      if (this.queues[priority].length > 0) {
        return this.queues[priority].shift();
      }
    }
    return null;                                           // queue is empty
  }

  // Return total number of tasks across all priority levels.
  size() {
    return Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
  }
}

// ──────────────────────────────────────────────
// NOTIFICATION LOG
// ──────────────────────────────────────────────

// Tracks the lifecycle of every notification. In production, this would write
// to Cassandra or DynamoDB for high write throughput.
class NotificationLog {
  constructor() {
    this.entries = new Map();                               // notificationId -> entry
  }

  // Create a new log entry when a notification is first created.
  create(entry) {
    this.entries.set(entry.notificationId, {
      ...entry,
      status: 'created',
      createdAt: new Date().toISOString(),
      statusHistory: [{ status: 'created', at: new Date().toISOString() }]
    });
  }

  // Update the status of an existing notification.
  updateStatus(notificationId, status, errorDetails = null) {
    const entry = this.entries.get(notificationId);
    if (!entry) return;

    entry.status = status;
    entry.statusHistory.push({
      status,
      at: new Date().toISOString(),
      ...(errorDetails && { error: errorDetails })
    });

    if (status === 'sent')      entry.sentAt = new Date().toISOString();
    if (status === 'delivered') entry.deliveredAt = new Date().toISOString();
    if (status === 'failed')    entry.errorDetails = errorDetails;
  }

  // Retrieve the log entry for a specific notification.
  get(notificationId) {
    return this.entries.get(notificationId) || null;
  }

  // Retrieve all notifications for a user, sorted by creation time descending.
  getByUser(userId, limit = 50) {
    return Array.from(this.entries.values())
      .filter(e => e.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
}

// ──────────────────────────────────────────────
// USER PREFERENCE STORE
// ──────────────────────────────────────────────

// Stores per-user notification preferences. In production, this lives in
// PostgreSQL with a Redis cache layer.
class PreferenceStore {
  constructor() {
    this.preferences = new Map();
  }

  // Set preferences for a user.
  set(userId, prefs) {
    this.preferences.set(userId, {
      channels: { push: true, email: true, sms: true, in_app: true },
      categories: {},                                      // category -> channel overrides
      quietHoursStart: null,                               // e.g., '22:00'
      quietHoursEnd: null,                                 // e.g., '08:00'
      timezone: 'UTC',
      locale: 'en',
      ...prefs
    });
  }

  // Retrieve preferences for a user, returning defaults if none are set.
  get(userId) {
    return this.preferences.get(userId) || {
      channels: { push: true, email: true, sms: false, in_app: true },
      categories: {},
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'UTC',
      locale: 'en'
    };
  }

  // Check if the user is currently in do-not-disturb mode.
  isDND(userId) {
    const prefs = this.get(userId);
    if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;

    // Simplified DND check — production would use timezone-aware calculation
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const [startH, startM] = prefs.quietHoursStart.split(':').map(Number);
    const [endH, endM] = prefs.quietHoursEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    // Handles overnight DND (e.g., 22:00 to 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

// ──────────────────────────────────────────────
// DEVICE TOKEN STORE
// ──────────────────────────────────────────────

class DeviceTokenStore {
  constructor() {
    this.tokens = new Map();                               // userId -> [token objects]
  }

  // Register a device token for a user.
  register(userId, platform, tokenValue) {
    if (!this.tokens.has(userId)) {
      this.tokens.set(userId, []);
    }
    const existing = this.tokens.get(userId).find(t => t.value === tokenValue);
    if (!existing) {
      this.tokens.get(userId).push({
        value: tokenValue,
        platform,                                          // 'ios' or 'android'
        isActive: true,
        registeredAt: new Date().toISOString()
      });
    }
  }

  // Get all active tokens for a user.
  getActiveTokens(userId) {
    const tokens = this.tokens.get(userId) || [];
    return tokens.filter(t => t.isActive);
  }

  // Mark a token as inactive (e.g., after APNs reports it invalid).
  deactivate(tokenValue) {
    for (const [, tokens] of this.tokens) {
      const token = tokens.find(t => t.value === tokenValue);
      if (token) {
        token.isActive = false;
        token.deactivatedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }
}

// ──────────────────────────────────────────────
// CHANNEL PROVIDERS (simulated)
// ──────────────────────────────────────────────

// Simulates APNs, FCM, SendGrid, Twilio. In production, these would be
// HTTP clients calling the real provider APIs.
class PushProvider {
  async sendAPNs(deviceToken, payload) {
    // Simulate APNs HTTP/2 request
    await this._simulateLatency(50);
    if (Math.random() < 0.02) {                            // 2% simulated failure
      throw { code: 'SERVICE_UNAVAILABLE', retryable: true };
    }
    return { success: true, apnsId: crypto.randomUUID() };
  }

  async sendFCM(registrationToken, payload) {
    // Simulate FCM HTTP v1 request
    await this._simulateLatency(60);
    if (Math.random() < 0.02) {
      throw { code: 'UNAVAILABLE', retryable: true };
    }
    return { success: true, messageId: `fcm_${crypto.randomUUID()}` };
  }

  _simulateLatency(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class EmailProvider {
  async send(toEmail, subject, htmlBody) {
    await this._simulateLatency(100);
    if (Math.random() < 0.01) {
      throw { code: 'RATE_LIMIT', retryable: true };
    }
    return { success: true, messageId: `email_${crypto.randomUUID()}` };
  }

  _simulateLatency(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class SMSProvider {
  async send(toPhone, messageBody) {
    await this._simulateLatency(80);
    if (Math.random() < 0.03) {
      throw { code: 'CARRIER_UNAVAILABLE', retryable: true };
    }
    return { success: true, sid: `sms_${crypto.randomUUID()}` };
  }

  _simulateLatency(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ──────────────────────────────────────────────
// NOTIFICATION SERVICE (main orchestrator)
// ──────────────────────────────────────────────

class NotificationService {
  constructor() {
    // Initialize all subsystems
    this.dedup = new DeduplicationStore();
    this.rateLimiter = new RateLimiter();
    this.templateEngine = new TemplateEngine();
    this.notificationLog = new NotificationLog();
    this.preferenceStore = new PreferenceStore();
    this.deviceTokenStore = new DeviceTokenStore();

    // Initialize per-channel queues
    this.channelQueues = {
      push: new PriorityQueue('push'),
      email: new PriorityQueue('email'),
      sms: new PriorityQueue('sms'),
      in_app: new PriorityQueue('in_app')
    };

    // Initialize providers
    this.pushProvider = new PushProvider();
    this.emailProvider = new EmailProvider();
    this.smsProvider = new SMSProvider();

    // Dead letter queue for permanently failed notifications
    this.deadLetterQueue = [];

    // Metrics counters
    this.metrics = {
      received: 0, delivered: 0, failed: 0,
      deduplicated: 0, rateLimited: 0, dndFiltered: 0
    };
  }

  // ────────── INGESTION PHASE ──────────

  // Main entry point: accepts a notification request, validates it,
  // applies deduplication and rate limiting, and routes to channel queues.
  async handleRequest(request) {
    this.metrics.received++;

    // Step 1: Validate required fields
    const validation = this._validateRequest(request);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Step 2: Deduplication check
    const dedupKey = this._generateDedupKey(request);
    if (this.dedup.checkAndSet(dedupKey, CONFIG.deduplication.windowMs)) {
      this.metrics.deduplicated++;
      return { success: true, deduplicated: true, message: 'Duplicate notification skipped' };
    }

    // Step 3: Service-level rate limit
    if (this.rateLimiter.isServiceExceeded(request.sourceService || 'default')) {
      this.metrics.rateLimited++;
      return { success: false, error: 'Service rate limit exceeded', retryAfterMs: 60000 };
    }

    // Step 4: Look up user preferences and resolve enabled channels
    const prefs = this.preferenceStore.get(request.userId);
    let enabledChannels = this._resolveChannels(request, prefs);

    // Step 5: Apply user-level rate limits per channel
    enabledChannels = enabledChannels.filter(channel => {
      const exceeded = this.rateLimiter.isUserChannelExceeded(
        request.userId, channel, request.priority
      );
      if (exceeded) this.metrics.rateLimited++;
      return !exceeded;
    });

    // Step 6: Apply do-not-disturb filtering
    if (this.preferenceStore.isDND(request.userId) &&
        request.priority !== CONFIG.priorities.CRITICAL) {
      const beforeCount = enabledChannels.length;
      enabledChannels = enabledChannels.filter(ch => ch === 'in_app');
      if (enabledChannels.length < beforeCount) this.metrics.dndFiltered++;
    }

    // Step 7: If no channels remain, the notification is effectively suppressed
    if (enabledChannels.length === 0) {
      return { success: true, suppressed: true, message: 'All channels filtered' };
    }

    // Step 8: Render templates and enqueue per-channel delivery tasks
    const notificationId = crypto.randomUUID();
    const tasks = [];

    for (const channel of enabledChannels) {
      // Retrieve the correct template for this channel and user locale
      const template = this.templateEngine.getTemplate(
        request.templateId, channel, prefs.locale
      );
      // Render the template with the provided data
      const rendered = this.templateEngine.render(template, request.data || {});

      const task = {
        notificationId: `${notificationId}_${channel}`,   // unique per channel
        userId: request.userId,
        channel,
        content: rendered || { body: request.rawContent || 'Notification' },
        priority: request.priority || CONFIG.priorities.NORMAL,
        metadata: request.metadata || {},
        retryCount: 0,
        createdAt: new Date().toISOString()
      };

      // Enqueue the task to the appropriate channel queue
      this.channelQueues[channel].enqueue(task);
      tasks.push(task);

      // Log the notification creation
      this.notificationLog.create({
        notificationId: task.notificationId,
        userId: request.userId,
        templateId: request.templateId,
        channel,
        priority: task.priority
      });
    }

    return {
      success: true,
      notificationId,
      channels: enabledChannels,
      taskCount: tasks.length
    };
  }

  // ────────── DELIVERY PHASE ──────────

  // Process all pending delivery tasks across all channel queues.
  // In production, each channel would have its own pool of worker processes.
  async processDeliveryQueues() {
    const results = [];

    for (const channel of ['push', 'email', 'sms', 'in_app']) {
      const queue = this.channelQueues[channel];
      let task;

      while ((task = queue.dequeue()) !== null) {
        const result = await this._deliverTask(task);
        results.push(result);
      }
    }

    return results;
  }

  // Deliver a single task to its channel provider.
  async _deliverTask(task) {
    try {
      let result;

      switch (task.channel) {
        case 'push':
          result = await this._deliverPush(task);
          break;
        case 'email':
          result = await this._deliverEmail(task);
          break;
        case 'sms':
          result = await this._deliverSMS(task);
          break;
        case 'in_app':
          result = await this._deliverInApp(task);
          break;
      }

      // Mark as sent on success
      this.notificationLog.updateStatus(task.notificationId, 'sent');
      this.metrics.delivered++;
      return { notificationId: task.notificationId, status: 'sent', result };

    } catch (error) {
      return this._handleDeliveryFailure(task, error);
    }
  }

  // Deliver a push notification to all of the user's active devices.
  async _deliverPush(task) {
    const tokens = this.deviceTokenStore.getActiveTokens(task.userId);
    if (tokens.length === 0) {
      throw { code: 'NO_ACTIVE_TOKENS', retryable: false };
    }

    const results = [];
    for (const token of tokens) {
      const payload = {
        title: task.content.subject || '',
        body: task.content.body || '',
        data: task.metadata
      };

      if (token.platform === 'ios') {
        results.push(await this.pushProvider.sendAPNs(token.value, payload));
      } else {
        results.push(await this.pushProvider.sendFCM(token.value, payload));
      }
    }
    return results;
  }

  // Deliver an email notification via the email provider.
  async _deliverEmail(task) {
    // In production, userId would be resolved to an email address via user service
    const email = `user_${task.userId}@example.com`;
    return this.emailProvider.send(
      email,
      task.content.subject || 'Notification',
      task.content.body || ''
    );
  }

  // Deliver an SMS notification via the SMS provider.
  async _deliverSMS(task) {
    // In production, userId would be resolved to a phone number via user service
    const phone = `+1555000${String(task.userId).padStart(4, '0')}`;
    return this.smsProvider.send(phone, task.content.body || '');
  }

  // Deliver an in-app notification by writing to the notification center.
  async _deliverInApp(task) {
    // Write to notification center storage (in production: database insert)
    return {
      stored: true,
      notificationId: task.notificationId,
      displayedAt: new Date().toISOString()
    };
  }

  // Handle delivery failures with retry logic and dead letter queue.
  _handleDeliveryFailure(task, error) {
    const retryConfig = CONFIG.retryPolicy[task.channel];

    if (error.retryable && task.retryCount < retryConfig.maxRetries) {
      // Calculate exponential backoff delay
      const delayMs = retryConfig.baseDelayMs * Math.pow(2, task.retryCount);
      task.retryCount++;

      // Re-enqueue with incremented retry count
      this.channelQueues[task.channel].enqueue(task);

      return {
        notificationId: task.notificationId,
        status: 'retrying',
        retryCount: task.retryCount,
        nextRetryMs: delayMs
      };
    }

    // Max retries exhausted or non-retryable error — send to dead letter queue
    this.deadLetterQueue.push({
      task,
      error: error.code || error.message || 'Unknown error',
      failedAt: new Date().toISOString()
    });

    this.notificationLog.updateStatus(
      task.notificationId, 'failed', error.code || 'Unknown'
    );
    this.metrics.failed++;

    return {
      notificationId: task.notificationId,
      status: 'failed',
      error: error.code || 'Unknown'
    };
  }

  // ────────── HELPER METHODS ──────────

  // Validate that the request contains all required fields.
  _validateRequest(request) {
    if (!request.userId) return { valid: false, error: 'Missing userId' };
    if (!request.templateId && !request.rawContent) {
      return { valid: false, error: 'Missing templateId or rawContent' };
    }
    return { valid: true };
  }

  // Generate a deduplication key from the request's identifying fields.
  _generateDedupKey(request) {
    const raw = `${request.userId}:${request.templateId}:${request.eventId || ''}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  // Determine which channels are enabled for this notification type and user.
  _resolveChannels(request, preferences) {
    const allChannels = ['push', 'email', 'sms', 'in_app'];
    const requestedChannels = request.channels || allChannels;

    return requestedChannels.filter(channel => {
      // Check global channel preference
      if (!preferences.channels[channel]) return false;

      // Check category-specific override if applicable
      if (request.category && preferences.categories[request.category]) {
        const catPref = preferences.categories[request.category];
        if (catPref[channel] === false) return false;
      }

      return true;
    });
  }

  // Retrieve current metrics for monitoring dashboards.
  getMetrics() {
    return {
      ...this.metrics,
      queueDepths: {
        push: this.channelQueues.push.size(),
        email: this.channelQueues.email.size(),
        sms: this.channelQueues.sms.size(),
        in_app: this.channelQueues.in_app.size()
      },
      deadLetterQueueDepth: this.deadLetterQueue.length
    };
  }
}

// ──────────────────────────────────────────────
// DEMONSTRATION
// ──────────────────────────────────────────────

async function main() {
  const service = new NotificationService();

  // --- Setup: Register templates ---
  service.templateEngine.register('order_shipped', 'push', 'en', {
    subject: 'Your order has shipped!',
    body: 'Hi {{user.name}}, your order #{{order.id}} is on its way. Track: {{tracking.url}}'
  });
  service.templateEngine.register('order_shipped', 'email', 'en', {
    subject: 'Order #{{order.id}} Shipped',
    body: '<h1>Good news, {{user.name}}!</h1><p>Your order #{{order.id}} shipped via {{tracking.carrier}}.</p>'
  });
  service.templateEngine.register('order_shipped', 'sms', 'en', {
    body: 'Your order #{{order.id}} shipped! Track: {{tracking.url}}'
  });
  service.templateEngine.register('order_shipped', 'in_app', 'en', {
    subject: 'Order Shipped',
    body: 'Your order #{{order.id}} is on its way!'
  });

  // --- Setup: Register user preferences ---
  service.preferenceStore.set('user_123', {
    channels: { push: true, email: true, sms: true, in_app: true },
    locale: 'en',
    timezone: 'America/New_York'
  });

  // --- Setup: Register device tokens ---
  service.deviceTokenStore.register('user_123', 'ios', 'apns_token_abc123');
  service.deviceTokenStore.register('user_123', 'android', 'fcm_token_xyz789');

  // --- Send a notification ---
  console.log('=== Sending notification ===');
  const result = await service.handleRequest({
    userId: 'user_123',
    templateId: 'order_shipped',
    eventId: 'order_456_shipped',
    sourceService: 'order-service',
    priority: CONFIG.priorities.HIGH,
    category: 'transactional',
    data: {
      user: { name: 'Alice' },
      order: { id: '456' },
      tracking: { url: 'https://track.example.com/456', carrier: 'FedEx' }
    }
  });
  console.log('Ingestion result:', JSON.stringify(result, null, 2));

  // --- Process delivery queues ---
  console.log('\n=== Processing delivery queues ===');
  const deliveryResults = await service.processDeliveryQueues();
  deliveryResults.forEach(r => {
    console.log(`  ${r.notificationId}: ${r.status}`);
  });

  // --- Check deduplication ---
  console.log('\n=== Sending duplicate notification ===');
  const dupResult = await service.handleRequest({
    userId: 'user_123',
    templateId: 'order_shipped',
    eventId: 'order_456_shipped',                          // same eventId = duplicate
    sourceService: 'order-service',
    priority: CONFIG.priorities.HIGH,
    data: { user: { name: 'Alice' }, order: { id: '456' }, tracking: { url: '', carrier: '' } }
  });
  console.log('Duplicate result:', JSON.stringify(dupResult, null, 2));

  // --- View metrics ---
  console.log('\n=== Service Metrics ===');
  console.log(JSON.stringify(service.getMetrics(), null, 2));

  // --- View notification log for user ---
  console.log('\n=== Notification Log for user_123 ===');
  const log = service.notificationLog.getByUser('user_123');
  log.forEach(entry => {
    console.log(`  [${entry.channel}] ${entry.status} - ${entry.notificationId}`);
  });
}

main().catch(console.error);
```

**Line-by-Line Explanation of Key Sections**

The `DeduplicationStore` class wraps a simple Map that associates idempotency keys with expiry timestamps. The `checkAndSet` method atomically checks if a key exists and is still within its TTL, returning true for duplicates. In production, this would be a Redis `SET NX EX` command, which provides the same atomic check-and-set semantics.

The `RateLimiter` class implements fixed-window rate limiting. The `isExceeded` method takes a key (like `user:123:push:hourly`), a limit, and a window duration. It checks whether the counter for the current window exceeds the limit. The `isUserChannelExceeded` method adds business logic on top: critical-priority notifications bypass rate limiting entirely, while all other priorities are checked against both hourly and daily limits.

The `TemplateEngine` class handles template storage, locale-aware retrieval with fallback chains, and variable interpolation. The `_interpolate` method uses a regex to find `{{variable}}` patterns and resolves them by traversing nested object paths in the data. This supports patterns like `{{user.name}}` which resolves to `data.user.name`.

The `NotificationService.handleRequest` method is the main orchestrator. It follows the exact pipeline described in the architecture section: validate, deduplicate, rate-limit at the service level, resolve channels from preferences, rate-limit at the user level, apply DND filtering, render templates, and enqueue delivery tasks. Each step progressively narrows the set of channels and can short-circuit the pipeline entirely.

The `_handleDeliveryFailure` method implements the retry logic. It checks whether the error is retryable and whether the task has retries remaining. If so, it re-enqueues the task with an incremented retry count (the exponential backoff delay is calculated but, in this in-memory simulation, not actually enforced — a production system would use a delayed queue or scheduled re-enqueue). If retries are exhausted or the error is non-retryable, the task moves to the dead letter queue.

---

### Section 12 — Connection to Next Topic

The notification service and the news feed (the topic of our next design, Topic 47) are closer cousins than they might appear at first glance. Both systems solve fundamentally the same problem from different angles: getting the right content to the right user at the right time. A notification is a piece of content pushed to a user through an external channel. A news feed is a collection of content pulled by the user through the application interface. The underlying machinery — fan-out, personalization, prioritization, real-time delivery — is remarkably similar.

Consider the fan-out problem. When a user posts a photo on a social network, the notification service might send a push notification to the poster's close friends ("Alice posted a new photo"). Simultaneously, the news feed system must insert that photo into the feed of every follower. Both operations involve taking a single event (a photo was posted) and distributing it to a potentially large set of recipients. The notification service fans out to channel-specific queues; the news feed fans out to user-specific feed stores. The trade-offs are identical — do you fan out on write (precompute and store in each recipient's feed/notification list) or fan out on read (compute the feed/notification list on demand when the user requests it)?

Personalization connects the two systems as well. A notification service uses user preferences, rate limiting, and priority levels to decide whether and how to deliver a notification. A news feed uses engagement signals, relevance scoring, and diversity rules to decide which posts to show and in what order. Both systems must balance recency (showing the newest content) against relevance (showing the most important content), and both must avoid fatigue (notification overload maps directly to feed monotony).

In Topic 47, we will design a news feed and timeline system. We will reuse many of the patterns from this topic — message queues for fan-out, caching for fast reads, priority-based ordering, and real-time delivery via WebSocket — while introducing new challenges like feed ranking algorithms, hybrid fan-out strategies (fan-out-on-write for users with few followers, fan-out-on-read for celebrities), and the unique consistency requirements of a feed that must show the same content regardless of which server handles the request. The notification service you just designed will be a natural companion to the news feed, delivering alerts about high-engagement feed items that the user has not yet seen.

---

*Next up: **Topic 47 — Design a News Feed/Timeline**, where we tackle fan-out strategies, feed ranking, and the hybrid push-pull architecture that powers Facebook, Twitter, and LinkedIn timelines.*

---

<!--
Topic: 47
Title: Design a News Feed / Timeline (Twitter/Facebook)
Section: 10 — Real-World Designs Part 2
Track: 80/20 Core
Difficulty: mid-senior
Interview Weight: very-high
Prerequisites: Topics 1-3, 6, 8-10, 15, 25-26, 44
Next: Topic 48 (Design a Search Autocomplete/Typeahead)
Version: 1.0
Updated: 2026-02-25
-->

## Topic 47: Design a News Feed / Timeline (Twitter/Facebook)

---

### Section 1 — Why This Design?

On September 5, 2006, a young Facebook engineer named Ruchi Sanghvi shipped a feature that would fundamentally change how humans consume information on the internet. Before News Feed, Facebook was a collection of static profile pages you had to visit one by one to see what your friends were up to. Sanghvi's team built a personalized, reverse-chronological stream that aggregated activity from your entire social graph into a single, continuously updating page. Users revolted at first — hundreds of thousands joined protest groups on the platform itself, calling it "stalkerish" and invasive. Mark Zuckerberg published an open letter. Within weeks, the outrage subsided. Engagement metrics had exploded. People were spending dramatically more time on the site. The News Feed had won, and every social platform that followed would adopt some version of the same idea.

Twitter, launched earlier that same year, took a different approach. Its timeline was a raw, unfiltered, chronological stream of tweets from accounts you followed. Where Facebook curated, Twitter streamed. Where Facebook computed relevance, Twitter computed recency. But as Twitter scaled from thousands to hundreds of millions of users, the simplicity of chronological ordering became a liability. Users who followed thousands of accounts missed the tweets that mattered most. In 2016, Twitter introduced algorithmic ranking, and the same philosophical battle Facebook had navigated a decade earlier played out again in public.

The News Feed / Timeline design problem is, without exaggeration, one of the two or three most commonly asked system design interview questions at top-tier technology companies. There are several reasons for this. First, it touches nearly every major distributed systems concept: caching, sharding, fan-out, real-time delivery, ranking algorithms, graph traversal, and storage trade-offs. Second, the problem is deceptively simple to describe ("show users posts from people they follow") but extraordinarily complex to implement at scale. Third, the central technical challenge — the fan-out problem — is a beautiful illustration of how a single architectural decision can cascade into entirely different system shapes. When a user with 50 million followers publishes a post, do you immediately write that post into 50 million individual feeds, or do you wait until each of those 50 million users opens the app and compute their feed on demand? Neither answer is obviously correct, and the tradeoffs between them reveal a candidate's depth of understanding about latency, throughput, storage costs, and system complexity. This is the problem we are going to design from scratch.

---

### Section 2 — Requirements Gathering

Before drawing a single box on a whiteboard, you need to establish what you are building and what constraints you are building under. In an interview setting, spending the first five minutes on requirements gathering signals maturity and prevents you from designing the wrong system. Here is how to structure it.

**Functional Requirements**

The core functionality of a News Feed system breaks down into several distinct capabilities. First, **post creation**: users must be able to create posts that can contain text, images, videos, or links. A post belongs to a user and has a timestamp. Second, **news feed generation**: when a user opens the app, they should see a feed of recent posts from people they follow, ordered either chronologically or by relevance. This is the central feature. Third, **follow/friend system**: users can follow other users (Twitter model — asymmetric) or become mutual friends (Facebook model — symmetric). The social graph determines whose posts appear in whose feeds. Fourth, **engagement actions**: users can like, comment on, share, or retweet posts. These actions serve as signals for ranking and also generate secondary content that may appear in feeds. Fifth, **media support**: posts can include images and videos, which require separate storage, processing (thumbnail generation, transcoding), and delivery via CDN.

**Non-Functional Requirements**

The system must generate a user's feed in under 500 milliseconds. This is a hard latency requirement because feed loading is the single most common action on the platform and directly correlates with user engagement and retention. For real-time updates, when someone you follow publishes a new post, it should appear in your feed (or trigger a "new posts available" indicator) within a few seconds. The system must handle highly asymmetric load patterns — a celebrity with 80 million followers posting once creates a write amplification event that dwarfs anything a normal user generates. The system must be highly available (99.99% uptime target) because feed downtime means the entire product is effectively down. Eventual consistency is acceptable — if a new post takes 2-3 seconds to propagate to all follower feeds, that is fine. Partition tolerance is non-negotiable, so by the CAP theorem, we are choosing availability over strong consistency.

**Back-of-Envelope Estimation**

Let us size this system with realistic numbers. Assume 300 million daily active users (DAU). Each user follows an average of 500 accounts. Each user creates an average of 2 posts per day, yielding 600 million new posts per day, or roughly 7,000 posts per second. Feed reads vastly outnumber writes — assume each user checks their feed 10 times per day, producing 3 billion feed reads per day, or about 35,000 feed read requests per second. During peak hours (assume 3x average), that becomes 105,000 feed reads per second.

Now consider the fan-out. If we use a push model (fan-out on write), each new post must be delivered to all of the author's followers. With an average of 500 followers per user, a single post generates 500 feed cache writes. Across 600 million posts per day, that is 300 billion fan-out writes per day, or roughly 3.5 million fan-out writes per second. That is an enormous write amplification factor. For a celebrity with 50 million followers, a single tweet generates 50 million writes. This is the core tension of the entire design.

Storage estimation: each post is roughly 1 KB of metadata plus variable media. For 600 million posts/day, that is 600 GB of new post data per day, or about 219 TB per year just for post metadata. Feed caches (if pre-computed) store post IDs per user: if we cache the last 500 post IDs (8 bytes each) per user, that is 4 KB per user times 300 million users = 1.2 TB of feed cache in memory. This fits comfortably in a Redis cluster.

For bandwidth, if each feed request returns 20 posts averaging 10 KB each (including media thumbnails), that is 200 KB per request times 35,000 requests per second = 7 GB/s of outbound feed data. With CDN offloading media, the actual origin bandwidth is much lower.

---

### Section 3 — High-Level Architecture

The architecture of a News Feed system divides cleanly into two paths: the **write path** (what happens when a user creates a post) and the **read path** (what happens when a user opens their feed). Understanding this separation is fundamental.

The write path begins when a user publishes a post. The post is first persisted to the **Post Service**, which stores it durably in a database. The Post Service then emits an event to the **Fan-Out Service**, which is responsible for distributing the post to the feeds of all the author's followers. The Fan-Out Service queries the **User Graph Service** to determine the author's follower list, then writes the post ID into each follower's feed in the **Feed Cache** (a Redis cluster). Simultaneously, if the post contains media, the **Media Service** handles upload, processing (thumbnail generation, video transcoding), and storage on object storage (S3), with distribution via CDN.

The read path begins when a user opens the app and requests their feed. The request hits the **Feed Service**, which reads the pre-computed feed from the Feed Cache. The Feed Service hydrates the post IDs by fetching full post details from the Post Service, enriches them with social context (likes count, comments count, whether the requesting user has liked each post), applies any ranking or filtering logic, and returns the assembled feed to the client. A **Notification Service** handles push notifications and real-time update signals for new posts.

```
                         WRITE PATH
                         ==========

  User creates post
        |
        v
  +-------------+     +------------------+     +----------------+
  | API Gateway | --> | Post Service     | --> | Posts Database  |
  +-------------+     +------------------+     | (Sharded MySQL |
                            |                   | or Cassandra)  |
                            |                   +----------------+
                            | (async event)
                            v
                     +------------------+     +------------------+
                     | Fan-Out Service  | --> | User Graph       |
                     | (Message Queue)  |     | Service          |
                     +------------------+     | (Follower Lists) |
                            |                 +------------------+
                            |
                            v
                     +------------------+
                     | Feed Cache       |
                     | (Redis Cluster)  |
                     | Per-user sorted  |
                     | sets of post IDs |
                     +------------------+


                         READ PATH
                         =========

  User opens feed
        |
        v
  +-------------+     +------------------+     +------------------+
  | API Gateway | --> | Feed Service     | --> | Feed Cache       |
  +-------------+     +------------------+     | (Redis Cluster)  |
                            |                  +------------------+
                            |
                            v
                     +------------------+     +------------------+
                     | Post Service     | --> | Posts Database    |
                     | (Hydrate posts)  |     +------------------+
                     +------------------+
                            |
                            v
                     +------------------+
                     | Ranking /        |
                     | Personalization  |
                     | Service          |
                     +------------------+
                            |
                            v
                     Assembled Feed
                     returned to client
```

Several supporting services orbit this core. The **User Service** manages profiles and authentication. The **Social Graph Service** maintains follow/friend relationships (who follows whom). The **Engagement Service** tracks likes, comments, shares, and provides counts and user-specific engagement state. The **Media Service** handles all media processing and delivery. A **CDN** sits in front of media assets. A **Message Queue** (Kafka or similar) decouples the post creation from the fan-out work, ensuring that a slow fan-out does not block the user's post creation experience.

The key architectural insight is that write path and read path can be optimized independently. You can make writes fast and reads slow, or writes slow and reads fast. The fan-out strategy you choose determines which direction you lean, and that is what we explore next.

---

### Section 4 — Deep Dive: Fan-Out Strategies

The fan-out problem is the beating heart of the News Feed design. When user A publishes a post, how does that post reach the feeds of users B, C, D, and potentially millions of others who follow A? There are three fundamental strategies, and understanding them deeply is what separates strong interview performances from average ones.

**Fan-Out on Write (Push Model)**

In the push model, the moment a user publishes a post, the system immediately writes that post's ID into the pre-computed feed of every follower. This is called "fan-out on write" because the fan-out work happens at write time.

Here is how it works mechanically. User A publishes a post. The Post Service persists it and emits an event. The Fan-Out Service consumes the event, fetches A's follower list (say 500 users), and for each follower, inserts the post ID (along with the timestamp as a score) into that follower's sorted set in Redis. Now when follower B opens the app, B's feed is already pre-computed — the Feed Service just reads the sorted set from Redis, hydrates the post IDs, and returns the result. Feed reads are extremely fast (a single Redis ZREVRANGE command), typically completing in under 10 milliseconds.

The advantages are clear: read latency is minimal, the read path is simple, and the user experience is snappy. The disadvantages are equally clear: write amplification is enormous. A celebrity with 50 million followers generates 50 million Redis writes for a single post. Even at 100,000 writes per second to Redis, fanning out to 50 million users takes over 8 minutes. During those 8 minutes, some followers see the post and others do not, creating an inconsistency window. Furthermore, many of those 50 million followers may never open the app that day, meaning the majority of those writes were wasted.

Twitter originally used this approach for its entire timeline. It was called the "timeline fanout" architecture. The engineering team eventually published detailed accounts of how a single tweet from a user like Lady Gaga or Barack Obama could stress the entire fanout pipeline.

**Fan-Out on Read (Pull Model)**

In the pull model, nothing happens when a user publishes a post — the post is simply stored. The fan-out work happens when a follower opens their feed. The Feed Service fetches the list of accounts the user follows, queries recent posts from each of those accounts, merges and sorts them, and returns the result.

The advantages: writes are cheap and instant (just store the post), no wasted computation for inactive users, and celebrity posts require no special handling. The disadvantages: reads are expensive and slow. If a user follows 500 accounts, generating their feed requires 500 database lookups (or a large multi-key query), then merging and sorting the results. Even with heavy caching, this is orders of magnitude slower than reading a pre-computed feed from Redis. At 35,000 feed requests per second, the computational cost of on-demand feed generation is staggering.

Facebook's early architecture leaned toward this model for certain types of content, though it was augmented with heavy caching and a sophisticated aggregation layer.

**Hybrid Approach (The Correct Answer)**

In practice, every major social platform uses a hybrid of both strategies, and this is the answer interviewers are looking for. The hybrid approach uses fan-out on write for the vast majority of users (whose follower counts are in the hundreds or low thousands) and fan-out on read for celebrity users (whose follower counts are in the millions).

The implementation works like this. Define a threshold — say 10,000 followers. When a user with fewer than 10,000 followers posts, use the push model: fan out the post to all followers' pre-computed feeds immediately. When a celebrity with more than 10,000 followers posts, do NOT fan out. Instead, store the post and flag the celebrity as a "pull" source. When a user opens their feed, the Feed Service reads their pre-computed feed from Redis (which contains posts from all their non-celebrity followees) and then merges in recent posts from any celebrities they follow (fetched on demand). This merge is cheap because a typical user follows at most a handful of celebrities.

Twitter adopted this hybrid model. When you open Twitter, your timeline is assembled from your pre-computed feed (containing tweets from your non-celebrity follows) merged with recent tweets from celebrities you follow. The merge is fast because there are typically fewer than 20-30 celebrity accounts to query.

Facebook uses a different variation. Because Facebook's social graph is symmetric (friendships, not follows), the follower count distribution is less extreme, and the ranking algorithm is more aggressive. Facebook leans more heavily on fan-out on write but combines it with a real-time ranking layer that reorders and filters the pre-computed feed at read time.

| Aspect                | Fan-Out on Write     | Fan-Out on Read      | Hybrid               |
|----------------------|----------------------|----------------------|----------------------|
| Read latency         | Very low (<10ms)     | High (100-500ms)     | Low (<50ms)          |
| Write cost           | Very high            | Very low             | Moderate             |
| Celebrity handling   | Extremely expensive  | No extra cost        | Optimized            |
| Wasted computation   | High (inactive users)| None                 | Low                  |
| Implementation       | Moderate             | Simple               | Complex              |
| Consistency window   | Minutes for celebs   | None                 | Seconds              |
| Real-world users     | Early Twitter        | Some read-heavy apps | Twitter, Facebook    |

---

### Section 5 — Database Design

The News Feed system involves multiple data models, each with different access patterns, consistency requirements, and scale characteristics. Using a single database for everything would be an architectural mistake — this is a textbook case for polyglot persistence, where each data type is stored in the technology best suited to its access patterns.

**Post Storage**

Posts are the primary content objects. Each post has an ID, author ID, content (text), media references, creation timestamp, and engagement counters (likes count, comments count, share count). Posts are write-once, read-many, and their primary access pattern is point lookups by post ID (for hydration during feed assembly). Secondary access patterns include fetching recent posts by a specific user (for profile pages and the pull-model celebrity query).

A sharded relational database (MySQL or PostgreSQL) or a wide-column store (Cassandra) works well here. If using MySQL, shard by post ID (or author ID for author-centric queries). If using Cassandra, use author ID as the partition key and timestamp as the clustering key, which gives you efficient queries for "recent posts by user X" — exactly what the pull model needs for celebrities.

```
Posts Table (Cassandra)
+-----------+------------+---------+-----------+----------+------------+
| author_id | created_at | post_id | content   | media_ids| post_type  |
| (PK)      | (CK, DESC) |         |           |          |            |
+-----------+------------+---------+-----------+----------+------------+
| user_123  | 2026-02-25 | post_ab | "Hello.." | [m1, m2] | text+image |
| user_123  | 2026-02-24 | post_cd | "Great.." | []       | text       |
+-----------+------------+---------+-----------+----------+------------+
```

**User and Social Graph Storage**

The social graph — who follows whom — is the most critical data structure in the system because the Fan-Out Service queries it for every single post. The access patterns are: given user A, return all followers of A (for fan-out on write), and given user B, return all accounts B follows (for fan-out on read and the hybrid merge step).

For a follow relationship (asymmetric, like Twitter), you need two tables: one indexed by followee (for "who follows me?") and one indexed by follower (for "who do I follow?"). In Cassandra, this is modeled as two tables with different partition keys.

```
Followers Table (Cassandra)
+-------------+-------------+------------+
| followee_id | follower_id | created_at |
| (PK)        | (CK)        |            |
+-------------+-------------+------------+
| user_123    | user_456    | 2026-01-15 |
| user_123    | user_789    | 2026-02-01 |
+-------------+-------------+------------+

Following Table (Cassandra)
+-------------+-------------+------------+
| follower_id | followee_id | created_at |
| (PK)        | (CK)        |            |
+-------------+-------------+------------+
| user_456    | user_123    | 2026-01-15 |
| user_456    | user_999    | 2026-01-20 |
+-------------+-------------+------------+
```

An alternative for the social graph is a dedicated graph database like Neo4j or Amazon Neptune. Graph databases excel at traversal queries (e.g., "find friends of friends" or "mutual followers"), but for the simple one-hop queries the feed system needs, a wide-column store is sufficient and scales more predictably.

**Feed Cache (Redis Sorted Sets)**

The pre-computed feed is stored in Redis using sorted sets. Each user has a sorted set where members are post IDs and scores are timestamps (Unix epoch in milliseconds). This gives us O(log N) insertion and O(log N + M) range queries (where M is the number of results), which maps perfectly to "insert a new post into this feed" and "get the 20 most recent posts."

```
Redis Feed Cache Structure

Key: feed:{user_id}
Type: Sorted Set
Members: post IDs
Scores: Unix timestamp (ms)

Example:
  feed:user_456
    post_ab  -> 1740489600000
    post_cd  -> 1740403200000
    post_ef  -> 1740316800000
    ...
    (capped at 800 entries per user)
```

We cap the feed at around 800 entries per user. Since most users scroll through at most 100-200 posts per session, 800 entries provide a generous buffer. Older entries are evicted automatically using ZREMRANGEBYRANK. This cap is critical for memory management — without it, highly active social graphs would cause unbounded cache growth.

**Media Metadata**

Media objects (images, videos) are stored as metadata records pointing to object storage (S3). The metadata includes the media ID, original upload URL, processed URLs (thumbnails of various sizes, transcoded video formats), dimensions, file size, and content type. This is stored in a simple key-value store or a relational table, since access is always by media ID.

The actual media files live in object storage behind a CDN. When the feed is assembled and returned to the client, it includes media URLs that point to the CDN, not to the origin storage. This offloads the vast majority of bandwidth from the feed-serving infrastructure.

---

### Section 6 — Feed Ranking and Personalization

The transition from chronological feeds to ranked feeds is one of the most consequential product decisions in the history of social media. Chronological ordering is simple, predictable, and fair — every post gets equal treatment. But it is also noisy: a user who follows 1,000 accounts and checks the app twice a day will miss the majority of posts. Ranked feeds solve this by surfacing the content most likely to be relevant and engaging to each individual user, at the cost of transparency and creator fairness.

**Chronological Ordering**

The simplest approach: sort posts by timestamp, newest first. This is what Twitter used exclusively until 2016, and what many users vocally prefer. The implementation is trivial when using the push model — the Redis sorted set already stores posts sorted by timestamp, so reading the feed is a single ZREVRANGE call. Chronological ordering has no cold-start problem, requires no training data, and is completely transparent. Its weakness is that it treats a post from your closest friend identically to a post from a brand you followed once two years ago. At scale, the signal-to-noise ratio degrades, engagement drops, and users churn.

**EdgeRank (Facebook's Original Algorithm)**

In 2010, Facebook publicly described EdgeRank, its original feed ranking algorithm. Despite being replaced by far more sophisticated ML models since then, EdgeRank remains an excellent interview talking point because its components illustrate the fundamental signals any feed ranking system uses.

EdgeRank scored each potential feed item using three factors: **Affinity** (how close the relationship between the viewer and the content creator — measured by profile visits, message history, comment interactions, mutual friends), **Weight** (the type of content — photos ranked higher than text, comments ranked higher than likes, because different "edge types" indicated different levels of engagement), and **Time Decay** (newer content scored higher — the score decayed exponentially with age). The formula was essentially: Score = Affinity x Weight x Decay. Posts with the highest scores were shown first.

**Modern ML-Based Ranking**

Today's feed ranking systems at Facebook, Twitter, TikTok, and similar platforms use sophisticated machine learning models that consider hundreds or thousands of features. The core prediction task is: given a user and a candidate post, predict the probability that the user will engage with that post (like, comment, share, click, or spend significant dwell time on it).

Features fed into the model include: content features (text sentiment, topic, media type, length), author features (author's historical engagement rate, relationship to the viewer, account age), viewer features (past engagement patterns, topical interests, active hours, device type), contextual features (time of day, day of week, how long since last session), and interaction features (mutual friends who engaged with the post, recency of last interaction with the author).

The ranking pipeline typically works in stages. First, a **candidate generation** stage retrieves the pool of eligible posts — from the pre-computed feed cache and from celebrity pull sources. This might yield 500-1,000 candidates. Second, a **lightweight ranking** stage (using a simpler model) scores all candidates and selects the top 100-200. Third, a **heavy ranking** stage (using the full ML model) re-scores the top candidates with full feature computation. Fourth, a **post-processing** stage applies business rules: diversity injection (do not show 5 posts from the same author in a row), deduplication (do not show a reshared post if the original was already shown), content policy filtering, and ad insertion.

**Diversity and Deduplication**

Without explicit diversity controls, a ranked feed tends to converge: if you engaged with cooking content recently, the algorithm will flood your feed with cooking content, creating a filter bubble and eventually causing content fatigue. Diversity injection deliberately spreads content types, authors, and topics throughout the feed. This is implemented as a post-processing pass: after ranking, walk through the ordered list and apply penalties to posts that are too similar to recently placed posts.

Deduplication handles cases where the same content appears through multiple paths — your friend shared an article, and the original author also appears in your feed. The deduplication logic collapses these into a single feed entry, typically favoring the version with the strongest social signal ("Your friend shared this").

---

### Section 7 — Scaling the Fan-Out

The fan-out problem is not merely an architectural question — it is an operational challenge that requires careful engineering at every layer. Here we address the specific scaling problems that arise in production.

**The Celebrity Problem in Detail**

Consider a user with 80 million followers who tweets 5 times per day. Under pure fan-out on write, each tweet generates 80 million Redis writes. At 100,000 writes per second (a generous throughput for a Redis cluster handling sorted set insertions), a single tweet takes 800 seconds (over 13 minutes) to fully propagate. During those 13 minutes, the system is under sustained heavy write load, and new tweets from the same celebrity queue up behind the previous one. With 5 tweets per day, the fan-out pipeline can fall hours behind. This is unsustainable.

The hybrid approach solves this by exempting celebrities from fan-out on write entirely. But the threshold must be chosen carefully. Set it too low (say 1,000 followers) and you push too many users into the pull model, making reads slower for most users. Set it too high (say 1 million followers) and you still have crippling fan-out costs for users with 500,000 followers. In practice, the threshold is often dynamic, based on the current load on the fan-out pipeline. Twitter's engineering team has described using thresholds in the range of 10,000-50,000 followers, adjustable in real time.

**Sharding the Social Graph**

The social graph must be sharded to handle the volume of queries. The followers table (keyed by followee ID) is the hot path for fan-out on write — when user A posts, we need all of A's followers. If this table is sharded by followee ID, a single partition contains all followers of a given user, and the fan-out query hits a single shard. This is efficient but creates hot spots for celebrities (a single shard holds 80 million rows for the celebrity partition).

The solution is to split large follower lists across multiple shards. Instead of a single partition for a celebrity, use composite partition keys (followee_id, bucket_number) where bucket_number ranges from 0 to N based on follower count. The fan-out service queries all buckets in parallel. This distributes the load across the cluster at the cost of slightly more complex query logic.

**Feed Cache Size Management**

Without size limits, the feed cache grows unboundedly. A user who follows 1,000 highly active accounts could accumulate tens of thousands of feed entries. We enforce a cap — typically 500-800 entries per user — using Redis's ZREMRANGEBYRANK command to trim the sorted set after each insertion. When a user scrolls past the cached entries (which is rare), the system falls back to the pull model for older content, fetching directly from the posts database.

Memory budgeting is critical. With 300 million users, 800 entries per user, and 8 bytes per entry (post ID) plus 8 bytes per score (timestamp), each user's feed consumes roughly 12.8 KB. Total: 300M x 12.8 KB = 3.84 TB. This requires a substantial Redis cluster (perhaps 50-100 nodes with 64 GB RAM each, accounting for replication and overhead). This is expensive but feasible for a company operating at this scale.

**Cursor-Based Pagination**

Never use offset-based pagination for feeds. The classic problem: if you request "page 2 with 20 items per page" using OFFSET 20, and a new post was inserted between your page 1 and page 2 requests, you will see a duplicate item (the last item from page 1 shifts to position 21 and appears again). In a fast-moving feed, this is constant.

Cursor-based pagination solves this. Instead of an offset, the client sends a cursor — the timestamp (or post ID) of the last item it received. The server responds with items older than that cursor. This is implemented as a Redis ZREVRANGEBYSCORE with the cursor as the maximum score. Even if new posts are inserted, the cursor-based query returns a consistent, non-overlapping page.

```
Cursor Pagination Flow:

Request 1: GET /feed?limit=20
Response:  [post_A(t=100), post_B(t=95), ..., post_T(t=42)]
           next_cursor = "42"

Request 2: GET /feed?limit=20&cursor=42
Response:  [post_U(t=41), post_V(t=38), ..., post_AN(t=5)]
           next_cursor = "5"

Even if new posts (t=101, t=99) arrive between requests,
page 2 correctly starts after t=42 with no duplicates.
```

---

### Section 8 — Real-Time Updates

A news feed that only updates when the user manually refreshes feels stale and lifeless. Modern feeds communicate new content availability in real time, but the implementation strategy differs based on the user's current engagement state and the platform's architecture.

**Long Polling vs WebSocket**

Long polling is the simpler approach: the client sends a request to the server asking "are there new posts since timestamp X?" The server holds the connection open (up to 30-60 seconds) until either new content is available or the timeout expires. If new content arrives, the server responds immediately. If the timeout expires, the client reconnects. Long polling works through all firewalls and proxies, requires no special server infrastructure, and is easy to implement. Its downside is overhead: each client maintains a persistent HTTP connection, and the server must track millions of pending long-poll requests.

WebSockets provide a persistent, bidirectional connection between client and server. Once established, the server can push updates to the client instantly with no polling overhead. WebSockets are more efficient for high-frequency updates but require sticky sessions (the client must stay connected to the same server), specialized server infrastructure (WebSocket servers handle connections differently from HTTP request-response servers), and more complex error handling (reconnection logic, message ordering guarantees). Twitter and Facebook both use WebSocket connections for real-time feed updates on desktop and long polling or server-sent events (SSE) as fallbacks for constrained environments.

**The "New Posts" Banner Pattern**

Rather than automatically inserting new posts into the feed (which would cause jarring layout shifts as the user is reading), most platforms use the "X new posts" banner pattern. When new posts arrive (detected via WebSocket or long polling), the client displays a banner at the top of the feed: "3 new posts." Tapping the banner scrolls to the top and reveals the new content. This pattern respects the user's reading context while communicating freshness.

The implementation is straightforward. The client maintains a local "last seen" timestamp. The server pushes notifications of new posts (just post IDs and timestamps, not full content). The client counts posts newer than "last seen" and updates the banner count. When the user taps the banner, the client fetches the full content of the new posts and prepends them to the feed.

**Streaming Architecture for Real-Time Updates**

For users who are actively engaged (scrolling, interacting), a more aggressive real-time strategy is warranted. A streaming architecture uses a message broker (Kafka) to create a real-time event stream. When a post is published, the fan-out service writes to both the feed cache (for future reads) and a Kafka topic partitioned by recipient user ID. WebSocket servers subscribe to the relevant Kafka partitions and push new posts to connected clients in near-real-time.

This creates a two-tier delivery system: the feed cache handles "catch-up" reads (what happened while I was away), and the streaming layer handles "live" delivery (what is happening right now). The streaming layer only needs to serve currently connected users (a fraction of DAU at any given moment), so its resource requirements are manageable.

For users who are not actively connected (the majority at any given time), the feed cache is sufficient. When they next open the app, they read their pre-computed feed, which already includes all posts published during their absence. This tiered approach avoids the waste of streaming content to millions of offline users.

**Handling Out-of-Order Delivery**

In a distributed system with asynchronous fan-out and real-time streaming, posts may arrive out of chronological order. A post from 5 minutes ago might arrive after a post from 2 minutes ago, because the fan-out for the older post was delayed (perhaps because the author has many followers). The client must handle this gracefully — typically by maintaining a local sorted buffer and inserting arriving posts at the correct chronological position. The "new posts" banner count should reflect the total number of unseen posts, not just the most recently arrived ones. This seemingly minor detail prevents confusing user experiences where "3 new posts" appears, but tapping it reveals only 2 posts, with the third arriving moments later.

---

### Section 9 — Trade-Offs and Design Decisions

System design interviews are fundamentally about trade-offs. There is never a single correct answer — there are options with different costs and benefits, and the interviewer wants to see that you understand both sides and can make a reasoned choice given specific constraints. Here are the major decision points in the News Feed design and how to reason about each.

**Fan-Out on Write vs Read vs Hybrid**

This is the central trade-off, discussed in depth in Section 4. The key insight to articulate: fan-out on write optimizes for read latency (which is what users experience), fan-out on read optimizes for write cost (which is what operations teams care about), and the hybrid approach acknowledges that the user base is not homogeneous — the same strategy should not apply to a user with 200 followers and a user with 50 million followers. In an interview, state clearly that you would use the hybrid approach, explain the threshold concept, and describe how the read path merges push-model results with pull-model results.

**Chronological vs Ranked Feed**

This is as much a product decision as a technical one. Chronological feeds are simpler to implement, more transparent to users, and fairer to content creators. Ranked feeds drive higher engagement metrics, surface more relevant content to users, and enable monetization through promoted content injection. The technical trade-off: chronological feeds require no ML infrastructure and can be served directly from the Redis sorted set. Ranked feeds require a feature store, model training pipeline, real-time inference infrastructure, and A/B testing framework. For an MVP or early-stage product, start with chronological. For a mature platform competing for engagement, ranking is necessary.

**Eventual Consistency in Feeds**

The feed is inherently eventually consistent. When a user posts, there is a propagation delay before all followers see it. When a user unfollows someone, there is a delay before that person's posts stop appearing. When a post is deleted, there is a delay before it vanishes from all feeds. This is acceptable because the feed is not a transactional system — nobody notices if a post appears 3 seconds late, and nobody's bank account is affected. The trade-off is against strong consistency, which would require synchronous fan-out (impossibly slow) or distributed transactions (impossibly complex and slow). In an interview, explicitly state that eventual consistency is acceptable for this use case and explain why.

**Cache Size vs Freshness**

The feed cache stores a finite number of entries per user (e.g., 800). A larger cache means users can scroll back further without hitting the slower pull-based fallback, but it increases memory costs linearly with the cap size. A smaller cache saves memory but creates a worse experience for heavy scrollers. The trade-off is straightforward: analyze user behavior data to determine how far users typically scroll, set the cache cap at the 99th percentile, and accept that the remaining 1% of ultra-heavy scrollers will experience slightly higher latency when they exceed the cache.

**Pre-Computation vs On-Demand**

Pre-computation (fan-out on write) front-loads work, making it available instantly when needed but wasting resources if the result is never consumed. On-demand computation (fan-out on read) avoids waste but introduces latency when the result is needed. This trade-off recurs throughout distributed systems, not just in feeds. The general principle: pre-compute when read frequency is high relative to write frequency, and compute on-demand when the opposite is true. Since feed reads outnumber writes by 10x, pre-computation is the right default.

**Graph Database vs Relational/Wide-Column for Social Graph**

Graph databases (Neo4j, Amazon Neptune) are purpose-built for relationship traversal and excel at queries like "friends of friends," "shortest path between two users," and "mutual connections." But the News Feed fan-out only requires one-hop queries: "get all followers of user X." A wide-column store like Cassandra handles this efficiently with a simple partition key lookup. The graph database adds operational complexity (different technology to manage, different failure modes, different scaling characteristics) for capabilities the feed system does not need. Use a wide-column store for the follow graph unless the product requires multi-hop graph queries (e.g., "people you may know" recommendations), in which case a graph database might be justified for that specific service, separate from the feed infrastructure.

---

### Section 10 — Interview Questions

**Beginner Tier**

**Q1: A user publishes a post. Walk through the sequence of operations that makes this post appear in their followers' feeds.**

When a user publishes a post, the client sends a POST request to the API gateway, which routes it to the Post Service. The Post Service validates the content (checking for length limits, profanity filters, and spam detection), generates a unique post ID, and persists the post to the posts database (e.g., Cassandra, partitioned by author ID with a timestamp clustering key). The Post Service then publishes an event to a message queue (Kafka topic). The Fan-Out Service consumes this event, retrieves the author's follower list from the social graph service, and checks the author's follower count against the celebrity threshold. If below the threshold, the Fan-Out Service iterates through all followers and inserts the post ID (with its timestamp as the score) into each follower's sorted set in the Redis feed cache using ZADD. It also trims each sorted set to the maximum cache size using ZREMRANGEBYRANK. If the author exceeds the celebrity threshold, the post is simply stored (it was already persisted) and no fan-out occurs — the post will be pulled on demand when followers request their feeds. If the post contains media, the media is uploaded to object storage and processed asynchronously (thumbnail generation, video transcoding), with the CDN URLs updated in the post record when processing completes. The entire fan-out is asynchronous — the user receives a success response as soon as the post is persisted, without waiting for fan-out to complete.

**Q2: Why do we use Redis sorted sets for the feed cache instead of a simple list?**

Redis sorted sets provide three capabilities that simple lists do not. First, each member has an associated score (the post's timestamp), which means the set is always maintained in sorted order. When we insert a new post with ZADD, it is automatically placed at the correct position — we never need to sort the feed ourselves. Second, sorted sets support efficient range queries with ZREVRANGEBYSCORE, which enables cursor-based pagination. Given a cursor (the timestamp of the last seen post), we can retrieve the next page of results in O(log N + M) time, where M is the page size. A list would require scanning from the beginning. Third, sorted sets support efficient trimming with ZREMRANGEBYRANK — we can cap the feed at a fixed size by removing the lowest-scored (oldest) entries in O(log N) time after each insertion. With a list, removing arbitrary elements is O(N). Fourth, sorted sets automatically handle deduplication — if the fan-out service accidentally tries to insert the same post ID twice (due to a retry), the sorted set simply updates the score rather than creating a duplicate entry. A list would store the duplicate.

**Q3: What happens when a user scrolls to the bottom of their cached feed?**

When the user scrolls past all entries in the Redis feed cache (e.g., they have exhausted all 800 cached entries), the system falls back to a pull-based approach for older content. The Feed Service detects that the cursor points to a timestamp older than the oldest entry in the cache. It then queries the posts database directly: for each account the user follows, it fetches posts older than the cursor, merges them, sorts by timestamp, and returns the next page. This fallback is significantly slower than cache-served reads (potentially 100-500ms vs. 5-10ms) but it is rare — fewer than 1% of feed sessions scroll this far. To optimize this fallback, the system can maintain a secondary cache of "deep history" feeds computed lazily and cached for heavy scrollers. Alternatively, the posts database can be optimized for this query pattern by maintaining a materialized view of posts sorted by timestamp per followee, enabling efficient range scans.

**Mid-Level Tier**

**Q4: Design the hybrid fan-out approach. How do you decide the threshold, and how does the read path merge push and pull results?**

The hybrid fan-out uses a follower count threshold to partition users into "push" (fan-out on write) and "pull" (fan-out on read) categories. The threshold is not a fixed constant — it is a dynamic configuration value tunable based on system load. A reasonable starting point is 10,000 followers, but the system should expose this as a runtime parameter adjustable via a configuration service. When the fan-out pipeline is under heavy load (queue depth exceeds a threshold), the system can temporarily lower the celebrity threshold to reduce fan-out volume, automatically shedding load.

On the write path, when a post is published, the Fan-Out Service checks the author's follower count. Below threshold: fan out to all followers' Redis feeds. Above threshold: store the post only (already done), no fan-out.

On the read path, when a user requests their feed, the Feed Service performs three steps. Step one: fetch the pre-computed feed from Redis (ZREVRANGEBYSCORE with cursor-based pagination). This contains posts from all non-celebrity followees. Step two: identify which of the user's followees are celebrities (above the threshold). This information can be cached in a user-level metadata record or a separate "celebrity follows" set in Redis. Step three: for each celebrity followee, fetch their most recent posts from the posts database (using the same cursor as the main feed for temporal alignment). Step four: merge the Redis results and the celebrity results into a single sorted list, take the top N, and return. The merge is efficient because there are typically few celebrity accounts per user (usually under 50), so the pull queries are limited.

Edge case: what happens when a user crosses the threshold (gains or loses followers past the boundary)? When a user crosses upward, stop fanning out their future posts. Their existing posts remain in followers' caches and will eventually age out. When a user crosses downward, begin fanning out their future posts. There is no need to backfill — the transition is seamless because the read path already handles both sources.

**Q5: How would you handle post deletion in a pre-computed feed system?**

Post deletion in a fan-out-on-write system is inherently eventually consistent. When a user deletes a post, the Post Service marks it as deleted in the posts database (soft delete). This is the source of truth. However, the post ID still exists in potentially millions of followers' Redis feed caches. There are two approaches to clean up.

Approach one (lazy deletion): do not proactively remove the post ID from feed caches. Instead, when the Feed Service hydrates post IDs (fetching full post details for display), it discovers that the post has been deleted and simply omits it from the response. The stale post ID remains in the cache but is invisible to users. Over time, it ages out naturally as new posts push it past the cache cap. This is simple and efficient but means the cache contains garbage entries that consume memory and waste hydration queries.

Approach two (proactive deletion): emit a "post deleted" event to the same fan-out pipeline. The Fan-Out Service processes the deletion the same way as a creation — iterating through followers and calling ZREM on the post ID in each feed cache. This is expensive (same fan-out cost as creation) but keeps caches clean. For celebrities, this is unnecessary since their posts are not in caches anyway.

The practical approach combines both: proactive deletion for non-celebrity posts (since the fan-out is bounded and manageable), and lazy deletion as a fallback for any missed caches. The hydration step always checks the post's deletion status, providing a safety net regardless of cache state.

**Q6: How would you implement "Trending Topics" on top of this feed infrastructure?**

Trending Topics requires real-time aggregation of content signals across the entire platform, which is architecturally distinct from the per-user feed but shares infrastructure. The approach uses a streaming pipeline built on Kafka. Every post creation event (already published to Kafka for fan-out) is also consumed by a Trends Service. This service extracts topics from posts using a combination of hashtag parsing, entity recognition, and keyword extraction. It then maintains sliding window counters (e.g., 1-hour, 4-hour, 24-hour windows) for each topic using a data structure like a Count-Min Sketch for approximate frequency counting, or Redis sorted sets with expiring keys. A topic "trends" when its current velocity (rate of mentions per minute) significantly exceeds its baseline velocity — this is important because absolute count would always favor permanently popular topics (like "weather" or "news"), while velocity captures topics that are spiking relative to their normal activity. The Trends Service periodically (every 1-5 minutes) computes the top trending topics by ranking on velocity, filters out permanently popular terms using a baseline dictionary, applies content policy filters (remove profanity, banned topics), and caches the result. The trending topics endpoint serves this cached list with geographic segmentation (trends can be global or local).

**Senior Tier**

**Q7: You notice that feed latency has increased by 200ms during peak hours. Walk through your debugging approach and potential causes.**

This is an operational problem that requires systematic diagnosis. Start by identifying which component in the read path introduced the latency. The feed read path has four stages: Redis cache read, post hydration (database queries), ranking/filtering, and response serialization. Instrument each stage with timing metrics (which should already exist in production) and identify the bottleneck.

If the Redis cache read is slow: check Redis cluster health — look for hot keys (a single celebrity's follower list might be causing uneven shard load), check if any Redis node is approaching memory limits (triggering eviction), check network latency between the Feed Service and Redis (a network partition or saturation issue), and check if the sorted sets have grown beyond expected size (the cap enforcement might have a bug).

If post hydration is slow: the Feed Service is making N database queries to fetch full post details for N post IDs. If N is large, this is slow. Check the posts database for increased query latency (perhaps due to a compaction storm in Cassandra, or a MySQL slave falling behind). Check the posts cache (there should be a cache layer between the Feed Service and the posts database) for decreased hit rate — perhaps a cache was restarted or an increased volume of new posts is exceeding cache capacity.

If ranking is slow: the ML ranking model might be taking longer due to increased feature computation cost (perhaps a new feature was deployed that is expensive to compute), or the model serving infrastructure might be under-provisioned for peak load.

If the problem is specific to peak hours, it is likely a capacity issue — either the Redis cluster, the posts database, or the ranking service is under-provisioned for peak traffic. The immediate mitigation is to reduce the number of posts fetched and ranked (temporarily lower the feed page size from 20 to 15), add caching at the hydration layer, or horizontally scale the bottleneck component. The long-term fix is to provision for peak plus headroom and implement load shedding (graceful degradation under extreme load — e.g., serve chronological feeds without ranking when the ranking service is overwhelmed).

**Q8: Design the feed system to support a new feature: "Close Friends" list where posts from close friends are always shown at the top of the feed.**

This requires changes to both the write path and the read path. On the data model side, introduce a "close friends" relationship: each user can designate up to N (say 50) of their followees as close friends. Store this in a Redis set per user (close_friends:{user_id}) for fast lookup.

On the write path, when a close friend publishes a post, the fan-out service needs to mark it specially. One approach: maintain two separate feed caches per user — a primary feed (all posts from followees) and a priority feed (posts from close friends only). The fan-out service checks whether the author is in any follower's close friends list. For each follower where the author is a close friend, write to both the primary feed and the priority feed.

On the read path, when assembling the feed, the Feed Service reads both the primary and priority feeds. Posts from the priority feed are boosted in the ranking (given a large score bonus) or placed in reserved slots at the top. If using a ranked feed, the simplest approach is to add a binary "is_close_friend" feature to the ranking model, which learns to heavily weight it. If using a chronological feed, reserve the top 3-5 slots for the most recent close friend posts, then fill the remaining slots chronologically from the primary feed.

The scalability impact is modest: the close friends list is small (up to 50) per user, the additional Redis writes during fan-out are bounded (each post's author is a close friend to a small subset of their followers), and the additional Redis read during feed assembly is a single set membership check. The main complexity is in the fan-out service, which must now check close friend membership during fan-out — this can be done efficiently by caching the reverse mapping (for author X, which of X's followers have X as a close friend) in a Redis set.

**Q9: How would you migrate a large social platform from a purely chronological feed to a ranked feed without disrupting the user experience?**

This migration is high-risk because the feed is the core product experience, and a bad ranking model could tank engagement metrics. The approach must be gradual, measured, and reversible.

Phase 1: Build the ranking infrastructure in parallel. Deploy the ML model training pipeline, feature store, and model serving infrastructure without changing the production feed path. Train the initial model on historical engagement data (which posts did users like, comment on, share, or click, and which did they scroll past). Validate the model offline using held-out test data and ensure it produces reasonable rankings.

Phase 2: Shadow scoring. Run the ranking model on every feed request, but do not use the results. Log the model's rankings alongside the actual chronological feed that is served. Analyze the logs: would the model have surfaced the posts users actually engaged with? Compare predicted engagement with actual engagement. Iterate on the model until offline metrics are satisfactory.

Phase 3: A/B test with a small cohort. Serve the ranked feed to 1-5% of users (randomly selected but stratified to be representative). Measure engagement metrics (likes per session, comments, time spent, retention), content creator metrics (reach distribution — are some creators losing all visibility?), and user complaints. Run the test for at least 2-4 weeks to capture weekly patterns. If metrics are positive, proceed. If metrics are negative or neutral, iterate on the model.

Phase 4: Gradual rollout. Increase the test population in stages: 5%, 10%, 25%, 50%, 100%. At each stage, monitor metrics and be prepared to roll back. Implement a user-facing toggle ("Show latest tweets first" / "Show top tweets first") so users who strongly prefer chronological can opt out. This reduces backlash and provides a pressure valve.

Phase 5: Optimize and iterate. Once fully rolled out, the ranking model enters a continuous improvement cycle. A/B test model changes, add new features, retrain on fresh data. Monitor for ranking pathologies: filter bubbles, engagement bait amplification, and content creator fairness.

Throughout this process, maintain the ability to serve chronological feeds instantly (the Redis sorted set is always there, sorted by timestamp). If the ranking service fails, graceful degradation means falling back to chronological ordering, not showing an error page. This fallback capability should never be removed, even after the ranked feed is fully rolled out.

---

### Section 11 — Complete Code Example

Below is a comprehensive implementation of a News Feed service with hybrid fan-out, Redis-based feed caching, cursor pagination, and celebrity handling. The code is presented first as pseudocode for clarity, then as a complete Node.js implementation with detailed explanations.

**Pseudocode**

```
CONSTANTS:
  CELEBRITY_THRESHOLD = 10000
  FEED_CACHE_SIZE = 800
  FEED_PAGE_SIZE = 20

FUNCTION createPost(userId, content, mediaIds):
  // Persist the post
  post = {
    id: generateUUID(),
    authorId: userId,
    content: content,
    mediaIds: mediaIds,
    createdAt: currentTimestamp()
  }
  database.posts.insert(post)

  // Determine fan-out strategy
  followerCount = socialGraph.getFollowerCount(userId)

  IF followerCount < CELEBRITY_THRESHOLD:
    // Fan-out on write: push to all followers' feeds
    enqueueFanOut(post)
  ELSE:
    // Celebrity: skip fan-out, will be pulled on read
    markAsCelebrity(userId)

  RETURN post

FUNCTION enqueueFanOut(post):
  // Async fan-out via message queue
  messageQueue.publish("fanout-topic", {
    postId: post.id,
    authorId: post.authorId,
    timestamp: post.createdAt
  })

FUNCTION processFanOut(event):
  // Consumer: process fan-out for a single post
  followers = socialGraph.getFollowers(event.authorId)

  FOR EACH followerId IN followers:
    // Add post to follower's feed cache
    redis.ZADD("feed:" + followerId, event.timestamp, event.postId)
    // Trim cache to size limit
    redis.ZREMRANGEBYRANK("feed:" + followerId, 0, -(FEED_CACHE_SIZE + 1))

FUNCTION getFeed(userId, cursor, limit):
  // Step 1: Read pre-computed feed from cache
  IF cursor IS NULL:
    maxScore = "+inf"
  ELSE:
    maxScore = "(" + cursor   // exclusive upper bound

  cachedPostIds = redis.ZREVRANGEBYSCORE(
    "feed:" + userId, maxScore, "-inf",
    LIMIT 0 (limit + 1)       // fetch one extra to detect "has more"
  )

  // Step 2: Merge in celebrity posts
  celebrityFollows = getCelebrityFollows(userId)
  celebrityPosts = []
  FOR EACH celebId IN celebrityFollows:
    recentPosts = database.posts.query(
      WHERE authorId = celebId
      AND createdAt < (cursor OR currentTimestamp())
      ORDER BY createdAt DESC
      LIMIT limit
    )
    celebrityPosts.append(recentPosts)

  // Step 3: Merge and sort all candidates
  allPostIds = merge(cachedPostIds, celebrityPosts)
  sortByTimestampDescending(allPostIds)
  pagePostIds = allPostIds[0 : limit]

  // Step 4: Hydrate post details
  posts = database.posts.batchGet(pagePostIds)

  // Step 5: Build pagination cursor
  hasMore = allPostIds.length > limit
  nextCursor = IF hasMore THEN posts.last().createdAt ELSE NULL

  RETURN { posts: posts, nextCursor: nextCursor, hasMore: hasMore }

FUNCTION getCelebrityFollows(userId):
  // Return list of celebrity users that userId follows
  allFollows = socialGraph.getFollowing(userId)
  celebrities = FILTER allFollows WHERE isCelebrity(id) = true
  RETURN celebrities
```

**Node.js Implementation**

```javascript
// news-feed-service.js
// Complete News Feed implementation with hybrid fan-out

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const Kafka = require('kafkajs');

// ---------------------------------------------------------------------------
// Configuration constants. These values are tunable in production via a
// configuration service. The celebrity threshold determines when the system
// switches from push to pull for a given author. The feed cache size caps
// memory usage per user. The page size controls how many posts are returned
// per feed request.
// ---------------------------------------------------------------------------
const CELEBRITY_THRESHOLD = 10_000;   // Follower count above which we skip fan-out
const FEED_CACHE_SIZE     = 800;      // Max entries in a user's Redis feed cache
const FEED_PAGE_SIZE      = 20;       // Default number of posts per feed page

// ---------------------------------------------------------------------------
// Redis client initialization. In production this would be a Redis Cluster
// client connecting to multiple shards. The sorted-set data structure is the
// backbone of the feed cache: members are post IDs, scores are Unix
// timestamps in milliseconds, giving us chronological ordering for free.
// ---------------------------------------------------------------------------
const redis = new Redis.Cluster([
  { host: 'redis-node-1', port: 6379 },
  { host: 'redis-node-2', port: 6379 },
  { host: 'redis-node-3', port: 6379 },
]);

// ---------------------------------------------------------------------------
// PostService: Handles creating, storing, and retrieving posts. In a real
// system this would talk to a sharded Cassandra cluster or MySQL. Here we
// show the interface that the feed service depends on.
// ---------------------------------------------------------------------------
class PostService {
  constructor(db) {
    this.db = db;  // Database client (Cassandra, MySQL, etc.)
  }

  // createPost persists a new post and returns the full post object.
  // The post ID is a UUID for global uniqueness across shards.
  // createdAt is stored as a Unix timestamp in milliseconds, which
  // becomes the score in the Redis sorted set.
  async createPost(userId, content, mediaIds = []) {
    const post = {
      id: uuidv4(),                      // Globally unique post identifier
      authorId: userId,                   // The user who created the post
      content: content,                   // Text content of the post
      mediaIds: mediaIds,                 // References to media objects in S3
      createdAt: Date.now(),              // Millisecond-precision timestamp
      likesCount: 0,                      // Denormalized engagement counters
      commentsCount: 0,                   // Updated asynchronously
      sharesCount: 0,
      isDeleted: false,                   // Soft delete flag
    };

    // Persist to primary storage. This is the source of truth.
    // In Cassandra: INSERT INTO posts (author_id, created_at, post_id, ...)
    // Partition key = author_id, clustering key = created_at DESC
    await this.db.execute(
      'INSERT INTO posts (id, author_id, content, media_ids, created_at) VALUES (?, ?, ?, ?, ?)',
      [post.id, post.authorId, post.content, post.mediaIds, post.createdAt]
    );

    return post;
  }

  // batchGetPosts retrieves full post objects for a list of post IDs.
  // This is the "hydration" step during feed assembly. We use a batch
  // query (IN clause or multi-get) to minimize round trips to the
  // database. Posts that are soft-deleted are filtered out.
  async batchGetPosts(postIds) {
    if (postIds.length === 0) return [];

    const posts = await this.db.execute(
      'SELECT * FROM posts WHERE id IN (?)',
      [postIds]
    );

    // Filter out deleted posts (lazy deletion safety net)
    return posts.filter(p => !p.isDeleted);
  }

  // getRecentPostsByUser fetches recent posts by a specific user,
  // used for the "pull" part of the hybrid approach. The query
  // leverages Cassandra's clustering key ordering for efficient
  // range scans on the author's partition.
  async getRecentPostsByUser(userId, beforeTimestamp, limit) {
    return this.db.execute(
      'SELECT * FROM posts WHERE author_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?',
      [userId, beforeTimestamp, limit]
    );
  }
}

// ---------------------------------------------------------------------------
// SocialGraphService: Manages follow relationships. Maintains two views of
// the graph: followers (given a user, who follows them) and following (given
// a user, who do they follow). Also tracks the celebrity flag for users
// whose follower count exceeds the threshold.
// ---------------------------------------------------------------------------
class SocialGraphService {
  constructor(db, redisClient) {
    this.db = db;
    this.redis = redisClient;
  }

  // getFollowers returns the full list of follower IDs for a given user.
  // For non-celebrity users (< 10K followers), this list is manageable.
  // For celebrity users, this method is not called during fan-out
  // (because celebrities are excluded from push fan-out).
  async getFollowers(userId) {
    return this.db.execute(
      'SELECT follower_id FROM followers WHERE followee_id = ?',
      [userId]
    );
  }

  // getFollowing returns the list of users that userId follows.
  // Used during feed reads to identify celebrity followees for
  // the pull portion of the hybrid approach.
  async getFollowing(userId) {
    return this.db.execute(
      'SELECT followee_id FROM following WHERE follower_id = ?',
      [userId]
    );
  }

  // getFollowerCount returns the number of followers for a user.
  // This is cached in Redis for fast lookup during the fan-out
  // decision. The cache is updated asynchronously when follow/
  // unfollow events occur.
  async getFollowerCount(userId) {
    const cached = await this.redis.get(`follower_count:${userId}`);
    if (cached !== null) return parseInt(cached, 10);

    const result = await this.db.execute(
      'SELECT COUNT(*) as count FROM followers WHERE followee_id = ?',
      [userId]
    );
    const count = result[0].count;

    // Cache for 5 minutes. Staleness is acceptable since the
    // threshold is a heuristic, not a hard boundary.
    await this.redis.setex(`follower_count:${userId}`, 300, count);
    return count;
  }

  // getCelebrityFollows returns the subset of a user's followees
  // who are celebrities (follower count > threshold). This is
  // cached per user because it changes infrequently.
  async getCelebrityFollows(userId) {
    const cacheKey = `celeb_follows:${userId}`;
    const cached = await this.redis.smembers(cacheKey);
    if (cached.length > 0) return cached;

    const following = await this.getFollowing(userId);
    const celebrities = [];

    // Check each followee's celebrity status. In production,
    // this would use a precomputed set of all celebrity user IDs
    // rather than checking each individually.
    for (const followeeId of following) {
      const isCeleb = await this.redis.sismember('celebrities', followeeId);
      if (isCeleb) celebrities.push(followeeId);
    }

    if (celebrities.length > 0) {
      await this.redis.sadd(cacheKey, ...celebrities);
      await this.redis.expire(cacheKey, 600);  // Cache for 10 minutes
    }

    return celebrities;
  }
}

// ---------------------------------------------------------------------------
// FanOutService: The core of the write path. Consumes post-creation events
// from Kafka and distributes post IDs to followers' feed caches. This
// service runs as a pool of consumer workers, partitioned by author ID
// to maintain ordering per author.
// ---------------------------------------------------------------------------
class FanOutService {
  constructor(redisClient, socialGraph) {
    this.redis = redisClient;
    this.socialGraph = socialGraph;
  }

  // processFanOut is called for each post that qualifies for push fan-out
  // (non-celebrity authors). It retrieves the author's follower list and
  // writes the post ID into each follower's feed cache.
  async processFanOut(postId, authorId, timestamp) {
    const followers = await this.socialGraph.getFollowers(authorId);

    // Process in batches to avoid overwhelming Redis. Each batch
    // is sent as a Redis pipeline for efficiency. A pipeline groups
    // multiple commands into a single round trip, dramatically
    // reducing network overhead.
    const BATCH_SIZE = 1000;

    for (let i = 0; i < followers.length; i += BATCH_SIZE) {
      const batch = followers.slice(i, i + BATCH_SIZE);
      const pipeline = this.redis.pipeline();

      for (const followerId of batch) {
        const feedKey = `feed:${followerId}`;

        // ZADD adds the post ID to the sorted set with the
        // timestamp as the score. If the post ID already exists
        // (idempotent retry), the score is simply updated.
        pipeline.zadd(feedKey, timestamp, postId);

        // ZREMRANGEBYRANK trims the sorted set to FEED_CACHE_SIZE
        // entries by removing the oldest entries (lowest scores).
        // The range 0 to -(FEED_CACHE_SIZE+1) removes everything
        // except the top FEED_CACHE_SIZE entries.
        pipeline.zremrangebyrank(feedKey, 0, -(FEED_CACHE_SIZE + 1));
      }

      // Execute the pipeline. All commands in the batch are sent
      // in a single network round trip and executed atomically
      // on each Redis node.
      await pipeline.exec();
    }
  }

  // handlePostDeletion removes a deleted post from all followers'
  // feed caches. This is the proactive deletion approach, executed
  // only for non-celebrity posts.
  async handlePostDeletion(postId, authorId) {
    const followers = await this.socialGraph.getFollowers(authorId);
    const BATCH_SIZE = 1000;

    for (let i = 0; i < followers.length; i += BATCH_SIZE) {
      const batch = followers.slice(i, i + BATCH_SIZE);
      const pipeline = this.redis.pipeline();

      for (const followerId of batch) {
        // ZREM removes the post ID from the sorted set.
        // If the post ID does not exist, this is a no-op.
        pipeline.zrem(`feed:${followerId}`, postId);
      }

      await pipeline.exec();
    }
  }
}

// ---------------------------------------------------------------------------
// FeedService: The core of the read path. Assembles a user's personalized
// feed by merging pre-computed cache entries with on-demand celebrity posts,
// hydrating post details, and applying pagination.
// ---------------------------------------------------------------------------
class FeedService {
  constructor(redisClient, postService, socialGraph, rankingService) {
    this.redis = redisClient;
    this.postService = postService;
    this.socialGraph = socialGraph;
    this.rankingService = rankingService;
  }

  // getFeed is the primary entry point. It accepts a user ID, an optional
  // cursor for pagination (the timestamp of the last post the client saw),
  // and an optional limit (defaults to FEED_PAGE_SIZE).
  async getFeed(userId, cursor = null, limit = FEED_PAGE_SIZE) {
    const now = Date.now();

    // -----------------------------------------------------------------------
    // Step 1: Read pre-computed feed from Redis cache.
    // ZREVRANGEBYSCORE returns members of the sorted set with scores
    // between max and min, in descending order (newest first).
    // If cursor is provided, we use "(<cursor>" as the exclusive upper
    // bound, meaning "scores strictly less than cursor."
    // We fetch limit+1 entries to detect whether more pages exist.
    // -----------------------------------------------------------------------
    const maxScore = cursor ? `(${cursor}` : '+inf';
    const minScore = '-inf';

    const cachedEntries = await this.redis.zrevrangebyscore(
      `feed:${userId}`,
      maxScore,
      minScore,
      'WITHSCORES',
      'LIMIT', 0, limit + 10  // Fetch extra to account for celebrity merge
    );

    // Parse Redis response: [postId1, score1, postId2, score2, ...]
    const cachedPosts = [];
    for (let i = 0; i < cachedEntries.length; i += 2) {
      cachedPosts.push({
        postId: cachedEntries[i],
        timestamp: parseInt(cachedEntries[i + 1], 10),
      });
    }

    // -----------------------------------------------------------------------
    // Step 2: Fetch recent posts from celebrity followees (pull model).
    // We only fetch celebrities the user follows, and only posts within
    // the same time window as the cached feed page.
    // -----------------------------------------------------------------------
    const celebrityFollows = await this.socialGraph.getCelebrityFollows(userId);
    const beforeTimestamp = cursor ? parseInt(cursor, 10) : now;
    const celebrityPosts = [];

    // Fetch celebrity posts in parallel for better latency.
    // Each query is scoped to a single celebrity and limited to
    // a small number of results.
    const celebrityQueries = celebrityFollows.map(celebId =>
      this.postService.getRecentPostsByUser(celebId, beforeTimestamp, limit)
    );
    const celebrityResults = await Promise.all(celebrityQueries);

    for (const posts of celebrityResults) {
      for (const post of posts) {
        celebrityPosts.push({
          postId: post.id,
          timestamp: post.createdAt,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Step 3: Merge cached posts and celebrity posts, sort by timestamp
    // descending, and take the top 'limit' entries.
    // -----------------------------------------------------------------------
    const allCandidates = [...cachedPosts, ...celebrityPosts];
    allCandidates.sort((a, b) => b.timestamp - a.timestamp);

    // Take limit+1 to determine if there are more pages
    const pageWithExtra = allCandidates.slice(0, limit + 1);
    const hasMore = pageWithExtra.length > limit;
    const pageEntries = pageWithExtra.slice(0, limit);

    // -----------------------------------------------------------------------
    // Step 4: Hydrate post IDs into full post objects.
    // This batch query fetches all post details in a single database
    // round trip. Deleted posts are filtered out during hydration.
    // -----------------------------------------------------------------------
    const postIds = pageEntries.map(e => e.postId);
    let posts = await this.postService.batchGetPosts(postIds);

    // -----------------------------------------------------------------------
    // Step 5 (optional): Apply ranking if configured.
    // For a chronological feed, skip this step. For a ranked feed,
    // the ranking service re-orders the posts based on predicted
    // engagement and personalization signals.
    // -----------------------------------------------------------------------
    if (this.rankingService) {
      posts = await this.rankingService.rankPosts(userId, posts);
    }

    // -----------------------------------------------------------------------
    // Step 6: Build the pagination cursor for the next page.
    // The cursor is the timestamp of the last post in the current page.
    // The client sends this cursor in the next request to get the
    // following page without duplicates.
    // -----------------------------------------------------------------------
    const nextCursor = hasMore && posts.length > 0
      ? posts[posts.length - 1].createdAt.toString()
      : null;

    return {
      posts,
      nextCursor,
      hasMore,
    };
  }
}

// ---------------------------------------------------------------------------
// API Layer: Express routes that expose the feed service to clients.
// These handlers perform input validation, call the appropriate service
// methods, and format the response.
// ---------------------------------------------------------------------------
const express = require('express');
const app = express();
app.use(express.json());

// Dependency injection (in production, use a DI container)
const db = /* database client */;
const postService = new PostService(db);
const socialGraph = new SocialGraphService(db, redis);
const fanOutService = new FanOutService(redis, socialGraph);
const feedService = new FeedService(redis, postService, socialGraph, null);

// POST /posts — Create a new post.
// After persisting the post, decides whether to fan out (push model)
// or skip fan-out (pull model for celebrities). Returns immediately
// without waiting for fan-out to complete.
app.post('/posts', async (req, res) => {
  try {
    const { userId, content, mediaIds } = req.body;

    // Validate input
    if (!userId || !content) {
      return res.status(400).json({ error: 'userId and content are required' });
    }
    if (content.length > 10000) {
      return res.status(400).json({ error: 'Content exceeds maximum length' });
    }

    // Create and persist the post
    const post = await postService.createPost(userId, content, mediaIds);

    // Determine fan-out strategy based on follower count
    const followerCount = await socialGraph.getFollowerCount(userId);

    if (followerCount < CELEBRITY_THRESHOLD) {
      // Non-celebrity: fan out asynchronously.
      // In production, this publishes to Kafka. Here we call
      // processFanOut directly for illustration, but it would
      // be consumed by a separate worker process.
      setImmediate(() => {
        fanOutService.processFanOut(post.id, post.authorId, post.createdAt)
          .catch(err => console.error('Fan-out error:', err));
      });
    } else {
      // Celebrity: ensure they are in the celebrity set.
      // Their posts will be fetched on-demand during feed reads.
      await redis.sadd('celebrities', userId);
    }

    // Return success immediately. The user does not wait for fan-out.
    res.status(201).json({ post });

  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /feed — Retrieve a user's personalized feed.
// Supports cursor-based pagination via the 'cursor' query parameter.
// The cursor is the timestamp of the last post the client received.
app.get('/feed', async (req, res) => {
  try {
    const { userId, cursor, limit } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const pageLimit = Math.min(parseInt(limit, 10) || FEED_PAGE_SIZE, 50);
    const feed = await feedService.getFeed(userId, cursor || null, pageLimit);

    res.json({
      posts: feed.posts,
      pagination: {
        nextCursor: feed.nextCursor,
        hasMore: feed.hasMore,
      },
    });

  } catch (error) {
    console.error('Error fetching feed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Kafka Consumer: Processes fan-out events from the message queue.
// In production, this runs as a separate service with multiple
// consumer instances partitioned by author ID.
// ---------------------------------------------------------------------------
async function startFanOutConsumer() {
  const kafka = new Kafka.Kafka({ brokers: ['kafka-1:9092', 'kafka-2:9092'] });
  const consumer = kafka.consumer({ groupId: 'fanout-service' });

  await consumer.connect();
  await consumer.subscribe({ topic: 'post-created', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value.toString());

      // event = { postId, authorId, timestamp }
      // Process fan-out: write to all followers' feed caches.
      await fanOutService.processFanOut(
        event.postId,
        event.authorId,
        event.timestamp
      );
    },
  });
}

// Start the server and consumer
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Feed service running on port ${PORT}`);
  startFanOutConsumer().catch(console.error);
});
```

Every line of the above implementation maps directly to the architectural decisions discussed throughout this topic. The `PostService.createPost` method handles the write path's first step: durable persistence. The `FanOutService.processFanOut` method implements the push model with batched Redis pipelines. The `FeedService.getFeed` method implements the hybrid read path: reading the pre-computed cache, merging celebrity posts, hydrating, and paginating. The API layer demonstrates the clean separation between the user-facing interface and the internal services. In a production system, these classes would be separate microservices communicating over gRPC or HTTP, with the Kafka consumer running as an independent worker pool. The code here is consolidated for clarity but preserves the exact same logical boundaries.

---

### Section 12 — Connection to Next Topic

The News Feed system we have designed in this topic solves the problem of **content distribution** — given a piece of content, deliver it to the right audience at the right time. The central challenges were fan-out strategies, feed caching, real-time delivery, and ranking. We optimized for a world where the system knows exactly who needs to see what (the social graph defines the distribution), and the challenge is doing it fast enough and at sufficient scale.

Topic 48 — Design a Search Autocomplete/Typeahead — shifts to the complementary problem of **content discovery**. Instead of pushing content to users based on their social graph, autocomplete helps users find content they are actively seeking. The user types a partial query, and the system must suggest completions in real-time — typically within 50-100 milliseconds, even faster than our 500ms feed latency target. Both systems share core architectural patterns: precomputation (pre-building suggestion tries is analogous to pre-computing feed caches), caching at the edge (both need to minimize latency for the most common requests), and handling extreme scale (every keystroke generates a query, just as every app open generates a feed read). But where the feed system's data structure was a sorted set of post IDs per user, the autocomplete system's data structure is a trie (prefix tree) of query strings weighted by popularity. Where the feed system's write path was a fan-out across followers, the autocomplete system's write path is updating query frequency counts from search logs. The transition from "distribute known content to known recipients" to "suggest unknown content based on partial input" takes us from graph-centric thinking to trie-centric thinking, and introduces a new set of ranking challenges where recency, popularity, and personalization must be balanced within an even tighter latency budget.

---

<!--
Topic: 48
Title: Design a Search Autocomplete / Typeahead
Section: 10 — Real-World Designs Part 2
Track: 0-to-100 Deep Mastery
Difficulty: mid
Interview Weight: high
Prerequisites: Topics 1-3, 6, 10, 13, 17
Next Topic: Topic 49 (Design a Web Crawler)
Type: System Design Case Study
Date: 2026-02-25
-->

## Topic 48: Design a Search Autocomplete / Typeahead

---

### Section 1 — Why This Design?

In the summer of 2004, a Google engineer named Kevin Gibbs was working on a "20% project" — the legendary policy that allowed Googlers to spend one day a week on experimental ideas outside their main responsibilities. Gibbs built a prototype called "Google Suggest," a feature that showed real-time search suggestions as the user typed into the Google search box. At the time, the idea seemed radical: the web was still largely request-response, users typed a full query, pressed Enter, and waited. The notion that a search engine could predict what you were looking for after just two or three keystrokes felt almost magical. Google Suggest launched publicly in December 2004 as a Google Labs experiment and eventually became a core feature of every Google Search interaction. Today, it is so deeply integrated into the search experience that most users cannot imagine searching without it.

The impact of autocomplete extends far beyond Google. Amazon uses product search suggestions to steer shoppers toward high-conversion items — when you type "wire" into Amazon's search bar, it instantly suggests "wireless earbuds," "wireless mouse," "wire shelving," each one backed by purchase frequency data, inventory levels, and personalized browsing history. YouTube's autocomplete surfaces trending video topics, helping creators understand what audiences want and helping viewers discover content they did not know they were looking for. Slack, GitHub, VS Code, Spotify, Twitter, and virtually every modern application with a search box implements some form of typeahead. The pattern has become so ubiquitous that its absence feels like a bug.

From a system design interview perspective, the Search Autocomplete problem is a favorite among interviewers at top-tier companies because it sits at a rich intersection of concerns. It tests your knowledge of specialized data structures (tries, prefix trees), your ability to reason about low-latency serving at massive scale, your understanding of data pipelines for aggregating query signals, and your awareness of user-facing product considerations like debouncing, personalization, and content safety. It is not a pure backend problem, nor a pure data structures problem — it demands that you think holistically about the full stack, from the browser all the way down to the batch processing pipeline that rebuilds the suggestion index. This makes it an ideal mid-difficulty question that can be explored at varying depths depending on the candidate's seniority.

---

### Section 2 — Requirements Gathering

Before sketching any architecture, a strong candidate pauses to clarify what the system actually needs to do. This requirements-gathering phase signals to the interviewer that you think before you code, and it dramatically reduces the chance of designing the wrong system.

**Functional Requirements**

The core feature is prefix-based suggestion: as a user types characters into a search box, the system returns a ranked list of 5 to 10 suggested completions in real-time. For example, typing "sys" might return "system design interview," "system of a down," "system32," "system restore windows 10," and "system requirements for GTA 6." The suggestions must blend popular global queries with personalized results — a software engineer who frequently searches for technical topics should see different suggestions than a music fan. Multi-language support is essential for a global product: a user typing in Japanese hiragana, Korean hangul, or Arabic script should receive meaningful suggestions in their language and script. Finally, offensive content filtering is non-negotiable — the system must suppress suggestions for queries that contain hate speech, explicit content, or legally restricted terms. Google famously filters autocomplete to avoid suggesting defamatory or dangerous content, and this has legal implications in jurisdictions like the European Union where "right to be forgotten" rulings apply.

**Non-Functional Requirements**

Latency is the single most critical non-functional requirement. Every keystroke fires an autocomplete request, and if the response takes more than 100 milliseconds, the suggestions arrive too late — the user has already typed the next character, and the suggestion list flickers distractively. The target is under 100ms end-to-end, from keypress to rendered suggestion list. At Google's scale, the system must handle 100,000 or more queries per second (QPS), with spikes during major events (elections, sports finals, breaking news). Freshness matters too: when a celebrity name trends on social media, autocomplete should surface it within minutes, not hours. Availability must be extremely high (99.99%+), because autocomplete is on the critical path of every search interaction — if it goes down, the degraded UX affects billions of queries.

**Back-of-Envelope Estimation**

Let us ground the requirements in numbers. Google processes roughly 8.5 billion searches per day (as of recent estimates). For our design, let us use a conservative 5 billion searches per day. On average, a user types about 4 characters before selecting a suggestion or completing their query. Each character typed triggers one autocomplete request (before debouncing optimizations). That gives us:

```
Autocomplete requests/day = 5B searches x 4 keystrokes = 20B requests/day
QPS = 20B / 86,400 seconds = ~231,000 QPS (average)
Peak QPS = ~3x average = ~700,000 QPS
```

For the suggestion corpus, assume we store the top 10 million unique queries with their frequency counts and metadata. Each query averages 25 characters (25 bytes), plus a 4-byte frequency counter, plus 50 bytes of metadata (language, category, freshness score). That is roughly 79 bytes per entry, or about 790 MB for the raw data. However, the trie structure itself is larger because each node stores pointers, character labels, and cached top-K results. A well-compressed trie for 10 million queries might consume 2-5 GB of memory — comfortably fits in a single server's RAM, but we will need many replicas for throughput and geographic distribution.

Storage for the query log pipeline is separate. If we log every search query for aggregation, at 5 billion queries/day with an average of 30 bytes per query, that is 150 GB/day of raw log data. With sampling (logging 1 in 10 queries), this drops to 15 GB/day — easily handled by a Kafka cluster feeding into a Spark aggregation job.

---

### Section 3 — High-Level Architecture

The autocomplete system naturally divides into two major data flows that operate on different timescales. The first is the **serving path** — the real-time, latency-critical flow that takes a user's prefix and returns ranked suggestions in under 100 milliseconds. The second is the **data collection and aggregation path** — the offline (or near-real-time) flow that ingests search queries, computes frequency statistics, builds and updates the trie data structure, and pushes fresh trie snapshots to the serving layer.

On the serving side, when a user types a character, the client (browser or mobile app) sends a request like `GET /autocomplete?q=sys&lang=en&user=u123` to a load balancer. The load balancer routes the request to one of many stateless autocomplete servers. Each server holds an in-memory trie (or a shard of the trie) and performs a prefix lookup to retrieve the top suggestions. Before returning the results, a lightweight ranking layer applies personalization signals and filters out offensive content. The response goes back through the load balancer, potentially cached at a CDN edge node for extremely popular prefixes.

On the data collection side, every search query executed by a user is logged to a message queue (Kafka). A sampling layer reduces the volume. A periodic aggregation job (running on Spark or a similar framework) reads the sampled query logs, computes frequency counts with time-decay weighting, and builds a new trie. The freshly built trie is serialized and distributed to the serving nodes via a blob store (S3 or GCS). Serving nodes pick up the new trie snapshot atomically (blue-green swap) without downtime. For trending queries that need to appear faster than the batch cycle, a separate real-time aggregation stream updates a small "trending overlay" that is merged with the batch trie at query time.

```
                              ASCII Architecture Diagram

   [User Browser / App]
          |
          | HTTP GET /autocomplete?q=prefix
          v
   [CDN Edge Cache] ----cache hit----> [Response]
          |
          | cache miss
          v
   [Load Balancer]
          |
          +---> [Autocomplete Server 1] --+
          +---> [Autocomplete Server 2]   +--> [In-Memory Trie + Ranking]
          +---> [Autocomplete Server N] --+
                      |
                      | trie snapshot load
                      v
               [Blob Store (S3)]
                      ^
                      | upload new trie
                      |
          [Trie Builder (Spark/MapReduce)]
                      ^
                      | aggregated query data
                      |
          [Aggregation Service]
                      ^
                      | sampled query logs
                      |
          [Kafka — Query Log Stream]
                      ^
                      | log every search
                      |
               [Search Service]
```

This separation of concerns is critical. The serving path is optimized for read latency — everything is in-memory, stateless, and horizontally scalable. The data collection path is optimized for throughput and correctness — it can afford higher latency because it runs in the background. The two paths communicate through the blob store, which acts as a clean interface between the online and offline worlds.

---

### Section 4 — Deep Dive: Trie Data Structure

The trie (from "retrieval," pronounced "try") is the canonical data structure for prefix-based search. A trie is a tree where each node represents a single character, and paths from the root to leaves (or marked internal nodes) spell out complete words or phrases. The key insight is that all strings sharing a common prefix share the same initial path in the trie, which means a prefix lookup touches only the nodes along that prefix — not the entire dataset. For a prefix of length L, the lookup is O(L), regardless of how many total strings are stored.

In a basic trie, each node contains an array (or hash map) of children indexed by character, and a flag indicating whether this node marks the end of a valid string. For autocomplete, we augment each node with a cached list of the top-K suggestions that can be reached from that node. This is the critical optimization: without it, finding the top-K completions would require traversing the entire subtrie below the prefix node and sorting by frequency — far too expensive for real-time serving. With cached top-K lists, a prefix lookup simply walks down the trie to the prefix node and returns the precomputed list in O(L) time.

The cost of caching top-K lists at every node is space. If we store 10 suggestions at each of the millions of nodes in the trie, the memory footprint grows significantly. This is where **compressed tries** (also known as Patricia tries or radix trees) help. A compressed trie merges chains of single-child nodes into a single edge labeled with the entire string segment. For example, instead of separate nodes for "s" -> "y" -> "s" -> "t" -> "e" -> "m", a compressed trie stores a single edge labeled "system." This can reduce the node count by 50-80% in practice, dramatically lowering memory usage.

**Trie Serialization** is important for distribution. The trie is built offline by the aggregation pipeline and must be shipped to hundreds of serving nodes. A common approach is to serialize the trie into a flat binary format — essentially a depth-first traversal encoded as a byte array with offsets for child pointers. This format can be memory-mapped (mmap) on the serving nodes, allowing the trie to be loaded nearly instantaneously without parsing overhead. Some systems use succinct data structures (like the LOUDS encoding) to compress the trie even further while still supporting fast lookups.

It is worth comparing the trie approach against alternatives:

**Hash-based prefix lookup**: Store every prefix of every query as a key in a hash map, mapping to its top-K suggestions. For the query "system design," you would store entries for "s", "sy", "sys", "syst", "syste", "system", "system ", "system d", and so on. This approach has O(1) lookup time but consumes significantly more space because each prefix gets its own entry. It also makes updates more expensive — changing the ranking for one query requires updating all of its prefix entries.

**Elasticsearch prefix queries**: Elasticsearch supports prefix queries and completion suggesters out of the box. The completion suggester uses an in-memory FST (finite state transducer) for fast prefix lookups. This approach is operationally convenient — you get sharding, replication, and cluster management for free — but it introduces the overhead of a network hop to the Elasticsearch cluster, and tuning it for sub-100ms latency at 200K+ QPS requires significant expertise. For a company the size of Google, a custom trie is the right choice; for a startup, Elasticsearch is a pragmatic starting point.

**Sorted arrays with binary search**: Store all queries sorted lexicographically in an array. Use binary search to find the first entry matching a prefix, then scan forward to collect the top-K. This is simple and cache-friendly but sorting by prefix order means the top-K by frequency are scattered through the range, requiring a secondary sort or a separate index. It works for small datasets but scales poorly.

---

### Section 5 — Data Collection and Aggregation

The quality of autocomplete suggestions is only as good as the data pipeline feeding the trie. This pipeline must answer one fundamental question: for each prefix, what are the most relevant completions right now? "Right now" is the key phrase — a static frequency count is insufficient because search behavior is deeply temporal. During a World Cup match, queries about the participating teams spike by orders of magnitude; after the match ends, they fade. A good autocomplete system reflects these dynamics.

**Query Logging Pipeline**

Every search query executed by a user is published to a Kafka topic. Each message contains the query string, a timestamp, the user's locale/language, and optionally a user identifier (hashed for privacy). At 5 billion searches per day, the raw stream is substantial but well within Kafka's capabilities — a Kafka cluster with 50 partitions and a replication factor of 3 handles this comfortably.

However, processing every single query for trie building is unnecessary and wasteful. **Sampling** is a standard technique: we log only 1 in 10 (or 1 in 100) queries, reducing volume by an order of magnitude while preserving statistically accurate frequency distributions. For rare queries (the long tail), sampling may miss some entries, but the autocomplete system is inherently biased toward popular queries — missing a query that occurs once a week is acceptable because it would never rank in the top-K anyway.

**Time-Weighted Frequency with Exponential Decay**

A naive frequency count treats a query searched 10,000 times two years ago the same as one searched 10,000 times this week. This produces stale suggestions. The solution is **exponential decay weighting**: each query's frequency contribution decreases exponentially with age. A common formula is:

```
weighted_frequency = sum over all occurrences of (count_i * e^(-lambda * age_i))
```

where `lambda` controls the decay rate. With a half-life of 7 days, a query that was popular last week retains about 50% of its weight; one from a month ago retains about 6%. This naturally favors recent and trending queries without requiring explicit "trending" logic, although a separate trending detector is still useful for surfacing sudden spikes.

**Aggregation Job**

The actual trie-building happens in a periodic batch job, typically running on Apache Spark. The job reads sampled query logs from the past N days (with exponential decay), groups by query string, computes the weighted frequency for each query, filters out queries below a minimum threshold, applies the offensive content blocklist, and outputs a sorted list of (query, weighted_frequency) pairs. A second phase of the job takes this sorted list and constructs the trie, populating each node's top-K cache by propagating frequencies upward from the leaf nodes. The final trie is serialized to a binary format and uploaded to a blob store (S3 or GCS).

This batch job runs on a schedule — perhaps every few hours, or once a day, depending on freshness requirements. The cadence is a trade-off: more frequent rebuilds mean fresher suggestions but consume more compute resources. Most systems run a full rebuild daily and supplement it with a **real-time trending overlay**. The overlay is a small, separate data structure (perhaps a simple hash map) populated by a Kafka Streams or Flink job that detects queries with rapidly increasing frequency. At query time, the serving layer merges results from the batch trie and the trending overlay, giving the trending overlay a ranking boost so that breaking-news queries appear quickly without waiting for the next batch rebuild.

**Real-Time vs. Batch Updates Trade-Off**

Purely real-time trie updates are conceptually appealing but operationally treacherous. Mutating a trie in-place while serving reads introduces concurrency hazards, requires careful locking or lock-free data structures, and makes it hard to reason about consistency. The batch-plus-overlay approach sidesteps this: the batch trie is immutable (read-only once loaded), and the overlay is a small, append-mostly structure that is easy to manage. This is a pattern you will see repeatedly in system design — immutable batch artifacts supplemented by a mutable real-time layer, often called the Lambda architecture.

---

### Section 6 — Ranking and Personalization

Returning raw frequency-sorted suggestions is a reasonable starting point, but production autocomplete systems layer multiple ranking signals to deliver the most useful results. The ranking function combines global popularity, trending signals, personalization, diversity, and safety filters into a final score for each candidate suggestion.

**Frequency-Based Ranking**

The baseline signal is the time-weighted frequency computed by the aggregation pipeline. If 50,000 users searched for "system design interview" last week and only 500 searched for "system dynamics," the former gets a much higher base score. This frequency signal is already embedded in the trie's top-K caches, so no extra computation is needed at serving time for the baseline ranking.

**Trending Boost**

Trending detection identifies queries whose frequency is increasing rapidly compared to their historical baseline. A simple approach is to compare the query's frequency in the last hour to its average frequency over the past 7 days. If the ratio exceeds a threshold (say, 5x), the query is marked as trending and receives a multiplicative boost in the ranking score. This ensures that when a major event breaks — a natural disaster, a celebrity death, an election result — the relevant queries surface in autocomplete within minutes, not hours. The trending overlay (from Section 5) provides the data; the ranking layer applies the boost.

**Personalization**

Personalized suggestions improve relevance by incorporating the individual user's history. If a software engineer frequently searches for "react hooks," then typing "re" should suggest "react hooks" highly — even if the global top suggestion for "re" is "real madrid." Personalization can be implemented at multiple levels of sophistication. A simple approach is to maintain a per-user hash map of recent queries (stored in a fast key-value store like Redis, keyed by user ID). At query time, the serving layer retrieves the user's recent queries, filters them by the current prefix, and merges them into the global top-K with a personalization boost. A more advanced approach uses collaborative filtering or embedding-based models to predict queries the user might be interested in, even if they have never searched for them before.

Privacy is a first-class concern in personalization. Users must be able to opt out, and personalization data should be stored with appropriate retention policies (e.g., automatically deleted after 90 days). In the European Union, GDPR requires that users can request deletion of their search history, and the autocomplete system must honor these requests promptly.

**Diversity in Suggestions**

A common pitfall is returning suggestions that are too similar. If the top 5 results for "py" are "python," "python tutorial," "python download," "python 3.12," and "python for beginners," the user gets little informational diversity. A diversity-aware ranker ensures that suggestions span different intents. One technique is Maximal Marginal Relevance (MMR), which iteratively selects suggestions that are both relevant to the prefix and dissimilar to already-selected suggestions. In practice, this often means including at least one suggestion from a different category — "pyramid scheme," for instance, to cover a non-programming intent.

**Offensive Content Filtering**

Autocomplete has a unique responsibility because it proactively suggests content — unlike regular search, where the user explicitly typed the full query. Suggesting offensive, defamatory, or dangerous completions is reputationally catastrophic and potentially illegal. Google maintains a blocklist of terms and patterns that must never appear in autocomplete. This blocklist is applied at two stages: during trie building (offensive queries are excluded from the corpus) and at serving time (a real-time filter catches edge cases missed by the batch blocklist). Machine learning classifiers augment the static blocklist by scoring suggestions for toxicity, sexual content, and violence. Suggestions exceeding a threshold are suppressed.

**Right to Be Forgotten**

In the European Union, the "right to be forgotten" ruling (Google Spain v. AEPD, 2014) grants individuals the right to request removal of search results (and by extension, autocomplete suggestions) that are "inadequate, irrelevant, or no longer relevant." Google processes tens of thousands of such requests annually. The autocomplete system must support a mechanism for removing specific suggestions within a defined SLA (typically 30 days). This is implemented as a deletion list that is applied both during trie building and at serving time.

---

### Section 7 — Caching and Performance

Autocomplete is one of the most latency-sensitive features in a search engine. Every millisecond counts because the user is actively typing, and stale or slow suggestions degrade the experience perceptibly. A multi-layer caching strategy is essential to achieve the sub-100ms target at scale.

**Browser Cache**

The first layer of caching is the client itself. When the user types "sys" and receives suggestions, the browser can cache this response locally. If the user deletes a character and retypes "sys," the cached response is served instantly without any network request. Modern browsers support this via standard HTTP caching headers (`Cache-Control: max-age=3600`). The cache duration should be short (minutes to an hour) to balance freshness with hit rate. Additionally, the client application can maintain an in-memory cache of recent prefix-response pairs, which is even faster than the browser's HTTP cache because it avoids the overhead of cache lookup in the browser's storage layer.

**CDN Cache**

The second layer is a Content Delivery Network. For extremely popular prefixes — single characters like "a," "b," "w," or two-character prefixes like "ho," "th," "wh" — the responses are identical (or nearly identical) for all users in a region (personalization aside). These can be cached at CDN edge nodes close to the user. The CDN cache dramatically reduces the load on the autocomplete servers because the most popular prefixes are also the most frequently requested. A rough analysis: there are only 26 single-letter prefixes and 676 two-letter prefixes. If these are cached at the CDN with a 5-minute TTL, a huge fraction of requests never reach the origin servers. CDN caching is most effective for non-personalized (global) suggestions. Personalized suggestions, by definition, vary per user and cannot be CDN-cached effectively.

**Application-Level Cache (Redis)**

The third layer is a Redis cache sitting in front of (or alongside) the autocomplete servers. Even though the trie is in-memory, a Redis cache can serve a complementary role: caching the final ranked and filtered response for a given prefix, including personalization. The key is the prefix plus the user segment (or "anonymous" for non-personalized requests), and the value is the serialized suggestion list. This avoids redundant trie lookups and ranking computations for identical requests. The cache is particularly useful during traffic spikes, when many users simultaneously type the same trending prefix. A TTL of 1-5 minutes balances freshness and hit rate.

**Cache Invalidation Strategy**

Cache invalidation is the hard part. When the trie is rebuilt with fresh data, all cached suggestions are potentially stale. The simplest approach is time-based expiration (TTL). CDN caches use a 5-minute TTL; Redis caches use a 1-minute TTL; browser caches use a 15-minute TTL. When a new trie snapshot is deployed, the serving nodes begin serving fresh results immediately, and the caches gradually converge to the new data as old entries expire. For urgent invalidations (e.g., removing a newly-offensive suggestion), the system can proactively purge specific cache entries via CDN purge APIs and Redis `DEL` commands.

**Prefix-Based Cache Partitioning**

An alternative to key-value caching is prefix-based partitioning: assign each autocomplete server responsibility for a range of prefixes (e.g., server 1 handles "a"-"d," server 2 handles "e"-"h," etc.). This is effectively a form of consistent hashing on the prefix. The benefit is that each server's in-memory trie only contains its assigned prefix range, reducing memory requirements per server. The load balancer routes requests based on the first character of the prefix. This approach improves cache locality but introduces the risk of hot spots — prefix "s" is far more popular than prefix "x" in English — so the partition boundaries must be tuned based on traffic distribution rather than simple alphabetical ranges.

**Client-Side Debouncing**

Finally, a critical performance optimization happens on the client side: debouncing. Without debouncing, every keystroke fires an HTTP request. A fast typist producing 8 characters per second generates 8 requests per second — most of which are wasted because the user does not care about the suggestions for intermediate prefixes. Debouncing waits for a brief pause in typing (typically 100-300 milliseconds) before sending the request. This reduces the request volume by 50-70% without noticeably degrading the UX, because users naturally pause slightly after typing a meaningful prefix chunk. Some implementations use a hybrid approach: fire immediately on the first keystroke (to show quick results) and then debounce subsequent keystrokes.

---

### Section 8 — Scaling

Scaling an autocomplete system to handle hundreds of thousands of QPS with sub-100ms latency requires careful attention to data partitioning, replication, geographic distribution, and zero-downtime updates.

**Trie Sharding by Prefix Range**

As discussed in the caching section, the trie can be sharded across multiple servers by prefix range. Each shard is responsible for a subset of the prefix space. The simplest approach is to shard by the first one or two characters: shard 1 handles all prefixes starting with "aa" through "az," shard 2 handles "ba" through "bz," and so on. This gives 676 shards for two-character partitioning, which is more than enough for even distribution. The load balancer uses a simple lookup table to route requests to the correct shard. Sharding by prefix is natural for this problem because every autocomplete request inherently specifies its shard via the prefix characters.

However, the distribution of prefixes is highly skewed. Prefixes starting with common letters like "s," "t," "c," and "p" receive far more traffic than rare letters like "x," "z," or "q." To handle this, the shard boundaries are not uniformly distributed but rather tuned based on historical traffic data. A prefix range that handles 2% of traffic gets one shard; a range that handles 10% of traffic gets five shards. This weighted sharding ensures approximately equal load per server.

**Replication for Read Throughput**

Each shard is replicated across multiple servers (typically 3-5 replicas). Since the autocomplete serving path is entirely read-only (the trie is immutable), replication is straightforward — every replica holds the same trie snapshot and can independently serve requests. The load balancer distributes requests across replicas within a shard using round-robin or least-connections. Replication provides both throughput scaling (more replicas = more QPS capacity) and fault tolerance (if one replica dies, others continue serving).

**Geographic Distribution**

For a global product, latency is dominated by network round-trip time. A user in Tokyo querying an autocomplete server in Virginia experiences 150+ milliseconds of network latency alone, blowing the 100ms budget before any processing begins. The solution is geographic distribution: deploy autocomplete server clusters in multiple regions (US-East, US-West, Europe, Asia-Pacific, etc.) and route users to the nearest cluster via DNS-based or anycast routing. Each regional cluster holds a full copy of the trie (or its assigned shards), rebuilt from the same aggregation pipeline. Regional customization is possible — the Asia-Pacific cluster might include more suggestions in CJK languages, while the European cluster emphasizes suggestions in European languages.

**Handling Hot Prefixes**

Certain prefixes become extremely hot during viral events. When a major news story breaks, millions of users simultaneously type the same prefix. Even with CDN caching and debouncing, the origin servers can see massive spikes on specific shards. Several mitigations apply: (1) The CDN cache absorbs the bulk of repeated requests for the same prefix. (2) Within the origin cluster, a local in-process cache (e.g., an LRU cache in each server process) prevents redundant trie lookups. (3) If a specific shard is overwhelmed, the system can dynamically add replicas for that shard (auto-scaling). (4) As a last resort, the system can shed load by returning slightly stale cached results or reducing the number of suggestions from 10 to 5.

**Blue-Green Trie Deployment**

Updating the trie without downtime is critical. The approach is blue-green deployment at the trie level. Each serving node maintains two trie slots: the "active" trie (currently serving traffic) and the "standby" trie (loading the new snapshot). When a new trie snapshot is available in the blob store, each serving node downloads it into the standby slot in the background. Once the download and validation are complete, the node atomically swaps the active and standby pointers. The swap is instantaneous (a single pointer assignment), so there is no period of unavailability. The old trie is garbage-collected after all in-flight requests using it have completed.

**Monitoring Suggestion Quality**

Scaling is not just about throughput — it is about maintaining quality as the system grows. Key metrics to monitor include: (1) **Suggestion click-through rate (CTR)** — what fraction of users click on a suggestion vs. completing their own query. A declining CTR suggests the suggestions are becoming less relevant. (2) **Suggestion latency (p50, p95, p99)** — ensuring that the latency SLA is met consistently. (3) **Trie freshness** — the age of the currently active trie snapshot; stale tries mean stale suggestions. (4) **Offensive suggestion reports** — the number of user reports about inappropriate suggestions, tracked and alarmed. (5) **Cache hit rate** — at each layer (browser, CDN, Redis, in-process), a declining hit rate may indicate a shift in traffic patterns requiring cache tuning.

---

### Section 9 — Trade-Offs and Design Decisions

Every system design involves trade-offs. A strong interview answer does not just present a single architecture but explicitly acknowledges the alternatives and explains why one choice was made over another. Here are the key trade-offs in the autocomplete system.

**Trie vs. Elasticsearch**

A custom in-memory trie gives you maximum control over memory layout, serialization, and query performance. It can serve a prefix lookup in microseconds. However, it requires significant engineering investment to build, test, optimize, and operate. Elasticsearch's completion suggester offers a production-ready prefix search with built-in sharding, replication, and monitoring. For a startup with limited engineering resources, Elasticsearch is the pragmatic choice. For a company serving billions of queries per day, the overhead and latency of an Elasticsearch network hop may be unacceptable, and a custom trie is worth the investment. The interview answer should demonstrate awareness of both approaches and explain the trade-off clearly.

**Real-Time vs. Batch Updates**

Purely real-time updates (updating the trie on every incoming query) give maximum freshness but introduce concurrency complexity and risk instability. Purely batch updates (rebuilding the trie every N hours) are simpler and more predictable but can leave suggestions stale during fast-moving events. The hybrid approach — batch trie with a real-time trending overlay — captures the benefits of both. The batch trie provides stable, well-ranked suggestions for the vast majority of queries, while the overlay handles the small number of rapidly-trending queries that need immediate visibility. This is the recommended approach for most production systems.

**Frequency vs. Recency**

Should the most-searched query of all time always rank first, or should recent popularity matter more? The answer is almost always "recent popularity matters more," because search behavior is inherently temporal. Exponential decay weighting (Section 5) balances frequency and recency mathematically. The decay rate (lambda) is a tunable parameter: a faster decay emphasizes recency more aggressively, while a slower decay gives more weight to historical frequency. In practice, this parameter is tuned experimentally by measuring suggestion CTR under different settings.

**Personalized vs. Global Suggestions**

Personalization improves relevance for repeat users but adds complexity (per-user data storage, privacy compliance, cold-start problem for new users). A system that serves only global suggestions is simpler and more cacheable. Most production systems serve a blend: the top 2-3 suggestions are personalized (drawn from the user's history), and the remaining suggestions are global. This hedge ensures that even if personalization data is unavailable (new user, opted out, cold cache), the suggestions are still useful.

**Accuracy vs. Latency**

A more sophisticated ranking model (e.g., a neural model that considers semantic context, user embeddings, and real-time signals) could produce more relevant suggestions, but it adds latency. Every millisecond of model inference is a millisecond stolen from the latency budget. In practice, autocomplete ranking models are deliberately simple — linear scoring functions with a handful of features — because the latency budget is so tight. Heavy ML models are used offline to compute features (like query embeddings) that are precomputed and stored in the trie, not at serving time.

**In-Memory vs. Disk-Based Trie**

An in-memory trie delivers microsecond lookups but limits the dataset to what fits in RAM. A disk-based trie (using memory-mapped files or an SSD-backed data structure) can handle larger datasets but introduces I/O latency. For the autocomplete use case, the dataset (top 10-50 million queries) is small enough to fit in memory on modern servers with 64-128 GB of RAM. Disk-based approaches are more relevant for scenarios with much larger datasets (e.g., email autocomplete across a user's entire mail archive). For the standard search autocomplete problem, in-memory is the right choice.

---

### Section 10 — Interview Questions

**Beginner Tier**

**Q1: What data structure would you use for autocomplete, and why?**

A strong answer identifies the trie (prefix tree) as the primary data structure. The candidate should explain that a trie organizes strings by their shared prefixes, allowing O(L) prefix lookups where L is the prefix length. The candidate should contrast this with a hash map (O(1) lookup but no prefix semantics — you would have to store every prefix separately) and a sorted array (O(log N) binary search to find the prefix range, but then O(K) to collect top-K results from an unordered range). The key insight is that the trie naturally groups strings by prefix, and by caching the top-K suggestions at each node, the lookup becomes a simple walk down the tree followed by a constant-time retrieval of the cached results. The candidate should also mention compressed tries (Patricia tries) as a space optimization that merges single-child chains.

**Q2: How would you handle the "cold start" problem for a new autocomplete system with no query data?**

A good answer recognizes that autocomplete requires a corpus of queries to function. Without historical query logs, the system can bootstrap from several alternative sources: (1) a dictionary or encyclopedia of common terms (Wikipedia article titles, for example), (2) query logs from a related product or partner, (3) web crawl data — the anchor text of hyperlinks on the web is a surprisingly good proxy for search queries because it reflects what people link to and click on, (4) trending topics from social media APIs (Twitter/X trending, Google Trends). The candidate should note that the initial suggestions will be lower quality than a mature system's because they lack the frequency signals that come from real user behavior. Over time, as the system accumulates its own query logs, the suggestions improve organically.

**Q3: Why is latency so critical for autocomplete, and what specific latency target would you aim for?**

The candidate should explain that autocomplete is uniquely latency-sensitive because it fires on every keystroke. If the response takes too long, the user has already typed more characters by the time the suggestions appear, making them stale and distracting. The target is under 100ms end-to-end (from keypress to rendered suggestion list). The candidate should break this down: approximately 20-40ms for network round-trip (assuming a nearby server), 1-5ms for trie lookup and ranking, and 10-20ms for rendering on the client. This leaves a comfortable margin. The candidate should also mention client-side debouncing as a complementary technique that reduces the number of requests without degrading perceived responsiveness.

**Mid Tier**

**Q4: How would you keep autocomplete suggestions fresh when queries change rapidly (e.g., during breaking news)?**

A strong answer describes the hybrid batch-plus-real-time architecture. The batch pipeline (Spark job running every few hours) rebuilds the trie from aggregated query logs with exponential decay weighting. This handles steady-state freshness well but cannot react to sudden spikes. For breaking news, a real-time streaming job (Kafka Streams or Flink) monitors the query stream for anomalies — queries whose frequency in the last 15 minutes exceeds, say, 5x their historical average. These trending queries are published to a small "trending overlay" data structure (a simple hash map of prefix -> trending suggestions). At serving time, the autocomplete server merges results from the batch trie and the trending overlay, giving the overlay a ranking boost. This way, a query that suddenly trends during a live event can appear in autocomplete within minutes, while the batch trie continues to provide stable results for the vast majority of prefixes.

**Q5: How would you shard the trie across multiple servers, and how do you handle the uneven distribution of prefixes?**

The candidate should propose sharding by prefix range — each server handles a contiguous range of prefixes (e.g., "a"-"d" on server 1, "e"-"h" on server 2). The load balancer inspects the first one or two characters of the query prefix to route to the correct shard. The critical follow-up is handling skew: in English, prefixes starting with "s," "t," "c," and "p" are far more common than "x" or "z." The candidate should propose weighted sharding based on historical traffic data: popular prefix ranges get more shards (i.e., the "s" range might be split across three servers, while "x" and "z" share one). The candidate should also mention replication within each shard for fault tolerance and throughput, and discuss how the load balancer's routing table is updated when shards are added or rebalanced.

**Q6: Describe the end-to-end flow of a single autocomplete request, including all caching layers.**

A thorough answer traces the request from the user's keystroke to the final response: (1) The user types a character. The client-side debouncer waits 150ms for a pause. (2) The debouncer fires and the client checks its local in-memory cache. Cache hit: render immediately. Cache miss: proceed. (3) The browser sends an HTTP GET request. The CDN edge node checks its cache. Cache hit: return the cached response (this is common for 1-2 character prefixes). Cache miss: forward to origin. (4) The load balancer routes the request to the correct shard based on the prefix. (5) The autocomplete server checks its local in-process LRU cache. Cache hit: return. Cache miss: proceed. (6) The server walks the in-memory trie to the prefix node and retrieves the cached top-K suggestions. (7) The ranking layer applies personalization (fetches user history from Redis), trending boosts (checks the trending overlay), and offensive content filtering. (8) The final ranked list is returned, and the response is stored in the CDN cache and the server's in-process cache for future requests. Total time: 50-80ms.

**Senior Tier**

**Q7: How would you design the autocomplete system to comply with GDPR's "right to be forgotten" while maintaining low latency?**

This is a nuanced question that tests the candidate's ability to balance legal requirements with technical constraints. The candidate should explain that "right to be forgotten" requests require removing specific queries from autocomplete suggestions. The challenge is that the trie is an immutable, precomputed data structure — you cannot easily "delete" a suggestion from it without rebuilding. The solution has two parts: (1) **Serving-time filter**: Maintain a real-time blocklist (stored in Redis or a similar fast store) of queries that must be suppressed. At serving time, after retrieving the top-K from the trie, the server filters out any suggestions that appear on the blocklist. This provides immediate compliance. (2) **Build-time exclusion**: The next trie rebuild incorporates the blocklist, permanently removing the offending queries from the trie. The serving-time filter is then cleaned up for those entries. The candidate should discuss the SLA (typically 30 days for GDPR compliance), the operational process for handling requests (a queue of deletion requests processed by a moderation team), and the privacy implications of the blocklist itself (it contains the very data being deleted, so it must be tightly access-controlled and audited).

**Q8: How would you evaluate and A/B test different autocomplete ranking algorithms in production?**

The candidate should describe a comprehensive experimentation framework. First, define the key metrics: (1) **Suggestion acceptance rate** — how often users click on a suggestion vs. typing their full query. (2) **Time to search** — the time from the first keystroke to the final search action (clicking a suggestion or pressing Enter). (3) **Characters typed before selection** — fewer characters typed means the suggestions are more predictive. (4) **Search result quality downstream** — do users who accept autocomplete suggestions have better engagement with the search results page? The A/B test setup randomly assigns users to control (current ranking algorithm) and treatment (new ranking algorithm) groups. The autocomplete server checks the user's experiment group and applies the corresponding ranking function. The candidate should discuss the importance of running the experiment for sufficient duration (at least 1-2 weeks to capture weekly cyclicality), ensuring statistical significance, and watching for guardrail metrics (latency regression, offensive suggestion rate increase). An advanced candidate might discuss interleaving experiments, where both algorithms' suggestions are mixed in a single suggestion list and the system observes which ones users select.

**Q9: If you were designing autocomplete for a system with 100+ languages, what unique challenges would arise and how would you address them?**

Multi-language autocomplete is significantly more complex than English-only. The candidate should identify several challenges: (1) **Character encoding**: Different scripts (Latin, CJK, Arabic, Devanagari) have radically different character sets. A trie node that uses a fixed-size array for children (assuming 26 English letters) is inadequate; hash-map-based children or Unicode-aware trie implementations are needed. (2) **Tokenization**: In languages like Chinese and Japanese, there are no spaces between words, so prefix matching must operate on character sequences rather than word boundaries. The query "tokyo" in Japanese might be typed as a sequence of hiragana characters that are then converted to kanji via an input method editor (IME), adding complexity to prefix matching. (3) **Script mixing**: Users sometimes mix scripts in a single query (e.g., typing "iPhone 15" in Latin characters followed by their native script). The trie must handle mixed-script prefixes gracefully. (4) **Separate tries per language**: A practical approach is to build separate tries for each major language, with the serving layer selecting the appropriate trie based on the user's locale, keyboard language, or detected script of the input. (5) **Transliteration**: Users may type a query in Latin characters that corresponds to a non-Latin word (e.g., typing "arigatou" to search for the Japanese word). Supporting transliteration-based autocomplete requires a mapping layer that converts transliterated input to the target script before trie lookup. The candidate should acknowledge that this is a deep and ongoing engineering challenge even at companies like Google.

---

### Section 11 — Complete Code Example

Below is a full implementation of the core autocomplete system: a compressed trie with top-K suggestion caching, an autocomplete API server, a query aggregation pipeline simulator, and prefix-based caching. We start with pseudocode for conceptual clarity, then provide a working Node.js implementation with detailed explanations.

**Pseudocode: Trie with Top-K Suggestions**

```
STRUCTURE TrieNode:
    children: MAP<character, TrieNode>
    is_end_of_query: BOOLEAN
    frequency: INTEGER
    top_suggestions: LIST<(query, frequency)>  // cached top-K

FUNCTION insert(root, query, frequency):
    node = root
    FOR each character c IN query:
        IF c NOT IN node.children:
            node.children[c] = new TrieNode()
        node = node.children[c]
    node.is_end_of_query = TRUE
    node.frequency = frequency

FUNCTION build_top_k_cache(node, k, current_prefix):
    // Collect all completions reachable from this node
    candidates = []
    IF node.is_end_of_query:
        candidates.ADD((current_prefix, node.frequency))

    FOR each (char, child) IN node.children:
        child_candidates = build_top_k_cache(child, k, current_prefix + char)
        candidates.MERGE(child_candidates)

    // Sort by frequency descending, keep top K
    candidates.SORT_BY_FREQUENCY_DESC()
    node.top_suggestions = candidates[0:k]
    RETURN candidates

FUNCTION autocomplete(root, prefix, k):
    node = root
    FOR each character c IN prefix:
        IF c NOT IN node.children:
            RETURN []  // no suggestions for this prefix
        node = node.children[c]
    RETURN node.top_suggestions[0:k]
```

This pseudocode captures the essential logic: we insert queries with their frequencies, recursively build top-K caches at every node (propagating candidates upward), and serve suggestions by walking to the prefix node and returning its cached list.

**Node.js Implementation**

```javascript
// ============================================================
// autocomplete-system.js
// A complete autocomplete / typeahead system implementation
// ============================================================

const http = require('http');

// ------------------------------------------------------------
// Part 1: Trie Data Structure with Top-K Caching
// ------------------------------------------------------------

class TrieNode {
  constructor() {
    // Hash map of child character -> TrieNode.
    // Using a Map instead of a fixed array to support
    // arbitrary Unicode characters (multi-language).
    this.children = new Map();

    // Marks whether this node is the end of a complete query.
    this.isEndOfQuery = false;

    // The frequency (popularity score) of this query,
    // set only when isEndOfQuery is true.
    this.frequency = 0;

    // Cached list of top-K suggestions reachable from
    // this node. Each entry is { query, frequency }.
    // Pre-computed during trie build to enable O(L) lookups.
    this.topSuggestions = [];
  }
}

class AutocompleteTrie {
  constructor(k = 10) {
    // The root node of the trie. It represents the
    // empty prefix "" — all queries are descendants.
    this.root = new TrieNode();

    // K: the number of top suggestions to cache at each node.
    this.k = k;
  }

  // Insert a query with its frequency into the trie.
  // This creates the path of nodes for each character
  // and marks the final node as an end-of-query node.
  insert(query, frequency) {
    let node = this.root;

    // Walk (or create) a path for each character in the query.
    for (const char of query) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);
    }

    // Mark the terminal node with the query's frequency.
    node.isEndOfQuery = true;
    node.frequency = frequency;
  }

  // After all queries are inserted, this method recursively
  // computes and caches the top-K suggestions at every node.
  // This is the key optimization: it makes lookups O(L) instead
  // of O(subtree_size) at query time.
  buildTopKCache(node = this.root, prefix = '') {
    // Collect all candidate suggestions reachable from this node.
    let candidates = [];

    // If this node itself is a complete query, include it.
    if (node.isEndOfQuery) {
      candidates.push({ query: prefix, frequency: node.frequency });
    }

    // Recursively collect candidates from all children.
    // Each child returns its own candidates, which we merge.
    for (const [char, childNode] of node.children) {
      const childCandidates = this.buildTopKCache(childNode, prefix + char);
      candidates = candidates.concat(childCandidates);
    }

    // Sort all candidates by frequency (descending) and keep
    // only the top K. This is the list cached at this node.
    candidates.sort((a, b) => b.frequency - a.frequency);
    node.topSuggestions = candidates.slice(0, this.k);

    // Return the candidates so the parent node can merge them.
    return candidates;
  }

  // Look up autocomplete suggestions for a given prefix.
  // Walks the trie to the prefix node and returns its cached
  // top-K list. Returns an empty array if the prefix is not found.
  search(prefix) {
    let node = this.root;

    // Navigate down the trie following the prefix characters.
    for (const char of prefix) {
      if (!node.children.has(char)) {
        // This prefix does not exist in the trie.
        return [];
      }
      node = node.children.get(char);
    }

    // Return the precomputed top-K suggestions for this prefix.
    return node.topSuggestions;
  }
}

// ------------------------------------------------------------
// Part 2: Query Aggregation Pipeline
// ------------------------------------------------------------

class QueryAggregator {
  constructor(decayLambda = 0.1) {
    // Stores raw query logs as { query, timestamp } entries.
    this.queryLogs = [];

    // Lambda controls the exponential decay rate.
    // Higher lambda = faster decay = more recency bias.
    this.decayLambda = decayLambda;
  }

  // Log a query with the current timestamp.
  // In production, this would publish to Kafka.
  logQuery(query) {
    this.queryLogs.push({
      query: query.toLowerCase().trim(),
      timestamp: Date.now(),
    });
  }

  // Compute time-weighted frequencies for all queries.
  // Recent queries contribute more to the frequency score
  // than older ones, via exponential decay.
  computeWeightedFrequencies() {
    const now = Date.now();
    const frequencies = new Map();

    for (const log of this.queryLogs) {
      // Calculate the age of this log entry in days.
      const ageDays = (now - log.timestamp) / (1000 * 60 * 60 * 24);

      // Apply exponential decay: e^(-lambda * age).
      // A query from 7 days ago with lambda=0.1 gets weight ~0.50.
      const weight = Math.exp(-this.decayLambda * ageDays);

      // Accumulate the weighted frequency for this query.
      const current = frequencies.get(log.query) || 0;
      frequencies.set(log.query, current + weight);
    }

    // Convert to a sorted array of { query, frequency } objects.
    const result = [];
    for (const [query, frequency] of frequencies) {
      result.push({ query, frequency: Math.round(frequency * 100) / 100 });
    }

    // Sort by frequency descending for convenient processing.
    result.sort((a, b) => b.frequency - a.frequency);
    return result;
  }

  // Build a trie from the aggregated weighted frequencies.
  // This simulates the Spark job that rebuilds the trie periodically.
  buildTrie(k = 10) {
    const trie = new AutocompleteTrie(k);
    const frequencies = this.computeWeightedFrequencies();

    // Insert each query into the trie with its weighted frequency.
    for (const { query, frequency } of frequencies) {
      trie.insert(query, frequency);
    }

    // Build the top-K cache at every node.
    trie.buildTopKCache();

    return trie;
  }
}

// ------------------------------------------------------------
// Part 3: Prefix-Based Cache (LRU)
// ------------------------------------------------------------

class PrefixCache {
  constructor(maxSize = 10000) {
    // Maximum number of entries in the cache.
    this.maxSize = maxSize;

    // The cache stores prefix -> { suggestions, timestamp }.
    // We use a Map because it preserves insertion order,
    // which helps with LRU eviction.
    this.cache = new Map();

    // Track cache statistics for monitoring.
    this.hits = 0;
    this.misses = 0;
  }

  // Retrieve cached suggestions for a prefix.
  // Returns null on cache miss.
  get(prefix) {
    if (this.cache.has(prefix)) {
      this.hits++;

      // Move to the end of the Map (most recently used).
      // This is the LRU "touch" operation.
      const value = this.cache.get(prefix);
      this.cache.delete(prefix);
      this.cache.set(prefix, value);

      return value.suggestions;
    }

    this.misses++;
    return null;
  }

  // Store suggestions for a prefix in the cache.
  set(prefix, suggestions, ttlMs = 60000) {
    // If the cache is full, evict the oldest entry (LRU).
    if (this.cache.size >= this.maxSize) {
      // Map.keys().next() gives the first (oldest) key.
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(prefix, {
      suggestions,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
  }

  // Remove expired entries. Called periodically.
  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (now - value.timestamp > value.ttl) {
        this.cache.delete(key);
      }
    }
  }

  // Return cache hit rate for monitoring.
  getHitRate() {
    const total = this.hits + this.misses;
    if (total === 0) return 0;
    return (this.hits / total * 100).toFixed(2) + '%';
  }
}

// ------------------------------------------------------------
// Part 4: Offensive Content Filter
// ------------------------------------------------------------

class ContentFilter {
  constructor() {
    // A blocklist of terms that must never appear in suggestions.
    // In production, this would be loaded from a database and
    // regularly updated by a content moderation team.
    this.blocklist = new Set([
      'offensive_term_1',
      'offensive_term_2',
      // ... thousands of entries in production
    ]);

    // "Right to be forgotten" deletion list.
    // Queries that must be suppressed due to legal requests.
    this.deletionList = new Set();
  }

  // Add a query to the deletion list (GDPR compliance).
  addDeletionRequest(query) {
    this.deletionList.add(query.toLowerCase().trim());
  }

  // Filter a list of suggestions, removing blocked and deleted entries.
  filter(suggestions) {
    return suggestions.filter((s) => {
      const queryLower = s.query.toLowerCase();

      // Check the offensive content blocklist.
      for (const blocked of this.blocklist) {
        if (queryLower.includes(blocked)) {
          return false;
        }
      }

      // Check the right-to-be-forgotten deletion list.
      if (this.deletionList.has(queryLower)) {
        return false;
      }

      return true;
    });
  }
}

// ------------------------------------------------------------
// Part 5: Autocomplete API Server
// ------------------------------------------------------------

class AutocompleteServer {
  constructor(port = 3000) {
    this.port = port;
    this.trie = null;
    this.cache = new PrefixCache(10000);
    this.filter = new ContentFilter();
    this.aggregator = new QueryAggregator(0.1);

    // Seed with sample data for demonstration purposes.
    this._seedData();

    // Build the initial trie from seeded data.
    this.trie = this.aggregator.buildTrie(10);

    // Periodically clean up expired cache entries.
    setInterval(() => this.cache.cleanup(), 30000);
  }

  // Seed the aggregator with sample query data.
  _seedData() {
    const sampleQueries = [
      { query: 'system design interview', count: 5000 },
      { query: 'system design primer', count: 3200 },
      { query: 'system of a down', count: 4500 },
      { query: 'system requirements', count: 2800 },
      { query: 'system restore', count: 2100 },
      { query: 'system32', count: 1800 },
      { query: 'systematic review', count: 1200 },
      { query: 'search engine optimization', count: 4000 },
      { query: 'search and rescue', count: 1500 },
      { query: 'search my phone', count: 2200 },
      { query: 'selenium tutorial', count: 1900 },
      { query: 'self driving cars', count: 2600 },
      { query: 'react hooks tutorial', count: 3800 },
      { query: 'react native', count: 3500 },
      { query: 'react router', count: 2900 },
      { query: 'redis tutorial', count: 2100 },
      { query: 'redis vs memcached', count: 1700 },
      { query: 'python tutorial', count: 5500 },
      { query: 'python download', count: 4200 },
      { query: 'python for beginners', count: 3600 },
      { query: 'python list comprehension', count: 2000 },
    ];

    // Simulate logging each query multiple times to build
    // realistic frequency distributions.
    for (const { query, count } of sampleQueries) {
      // We scale down for simulation; in production these
      // would be real logged events from Kafka.
      const simulatedLogs = Math.ceil(count / 100);
      for (let i = 0; i < simulatedLogs; i++) {
        this.aggregator.logQuery(query);
      }
    }
  }

  // Handle an autocomplete request.
  // Checks cache first, then falls back to trie lookup.
  handleAutocomplete(prefix, userId = null) {
    const normalizedPrefix = prefix.toLowerCase().trim();

    if (!normalizedPrefix) {
      return { suggestions: [], cached: false };
    }

    // Layer 1: Check the application-level cache.
    const cached = this.cache.get(normalizedPrefix);
    if (cached) {
      return { suggestions: cached, cached: true };
    }

    // Layer 2: Trie lookup.
    let suggestions = this.trie.search(normalizedPrefix);

    // Apply content filtering (blocklist + deletion list).
    suggestions = this.filter.filter(suggestions);

    // Apply personalization if a userId is provided.
    // (Simplified: in production, this would fetch from Redis.)
    if (userId) {
      suggestions = this._applyPersonalization(suggestions, userId);
    }

    // Store in cache for future requests.
    this.cache.set(normalizedPrefix, suggestions);

    return { suggestions, cached: false };
  }

  // Simplified personalization: boost suggestions that match
  // the user's hypothetical interest profile.
  _applyPersonalization(suggestions, userId) {
    // In production, you would fetch the user's recent queries
    // from Redis and merge/boost matching suggestions.
    // Here we return suggestions as-is for simplicity.
    return suggestions;
  }

  // Start the HTTP server.
  start() {
    const server = http.createServer((req, res) => {
      // Parse the URL to extract the prefix query parameter.
      const url = new URL(req.url, `http://localhost:${this.port}`);

      if (url.pathname === '/autocomplete') {
        const prefix = url.searchParams.get('q') || '';
        const userId = url.searchParams.get('user') || null;

        const result = this.handleAutocomplete(prefix, userId);

        // Set CORS and caching headers.
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Browser cache: 5 minutes for popular short prefixes,
        // 1 minute for longer, more specific prefixes.
        const cacheMaxAge = prefix.length <= 2 ? 300 : 60;
        res.setHeader('Cache-Control', `public, max-age=${cacheMaxAge}`);

        res.writeHead(200);
        res.end(JSON.stringify({
          prefix,
          suggestions: result.suggestions.map((s) => s.query),
          cached: result.cached,
          cacheHitRate: this.cache.getHitRate(),
        }));
      } else if (url.pathname === '/health') {
        // Health check endpoint for load balancer.
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'healthy' }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(this.port, () => {
      console.log(`Autocomplete server running on port ${this.port}`);
      console.log(`Try: http://localhost:${this.port}/autocomplete?q=sys`);
      console.log(`Try: http://localhost:${this.port}/autocomplete?q=re`);
      console.log(`Try: http://localhost:${this.port}/autocomplete?q=py`);
    });
  }
}

// ------------------------------------------------------------
// Part 6: Main — Run the Server
// ------------------------------------------------------------

// Uncomment the following lines to start the server:
// const server = new AutocompleteServer(3000);
// server.start();

// ------------------------------------------------------------
// Part 7: Demonstration (runs without starting the server)
// ------------------------------------------------------------

function demonstrate() {
  console.log('=== Autocomplete System Demonstration ===\n');

  // Step 1: Create an aggregator and log sample queries.
  const aggregator = new QueryAggregator(0.1);
  const queries = [
    'system design interview',
    'system design primer',
    'system of a down',
    'system requirements',
    'system restore',
    'search engine optimization',
    'search and rescue',
    'react hooks tutorial',
    'react native',
    'python tutorial',
    'python download',
  ];

  // Simulate query logs with varying frequencies.
  queries.forEach((q, i) => {
    const count = 50 - i * 4; // Decreasing frequency.
    for (let j = 0; j < count; j++) {
      aggregator.logQuery(q);
    }
  });

  // Step 2: Compute weighted frequencies.
  console.log('Weighted frequencies (top 5):');
  const frequencies = aggregator.computeWeightedFrequencies();
  frequencies.slice(0, 5).forEach((f) => {
    console.log(`  "${f.query}" -> ${f.frequency}`);
  });

  // Step 3: Build the trie.
  const trie = aggregator.buildTrie(5);
  console.log('\nTrie built successfully.\n');

  // Step 4: Test autocomplete lookups.
  const testPrefixes = ['sys', 'se', 're', 'py', 'z'];
  for (const prefix of testPrefixes) {
    const results = trie.search(prefix);
    console.log(`Autocomplete for "${prefix}":`);
    if (results.length === 0) {
      console.log('  (no suggestions)');
    } else {
      results.forEach((r) => {
        console.log(`  "${r.query}" (score: ${r.frequency})`);
      });
    }
    console.log();
  }

  // Step 5: Test the cache.
  const cache = new PrefixCache(100);
  cache.set('sys', [{ query: 'system design', frequency: 100 }]);
  const cacheResult = cache.get('sys');
  console.log('Cache test:', cacheResult ? 'HIT' : 'MISS');
  console.log('Cache hit rate:', cache.getHitRate());

  // Step 6: Test the content filter.
  const filter = new ContentFilter();
  filter.addDeletionRequest('system restore');
  const filtered = filter.filter([
    { query: 'system design interview', frequency: 50 },
    { query: 'system restore', frequency: 30 },
    { query: 'system requirements', frequency: 25 },
  ]);
  console.log('\nAfter filtering (removed "system restore"):');
  filtered.forEach((f) => console.log(`  "${f.query}"`));
}

// Run the demonstration.
demonstrate();
```

**Line-by-Line Explanation of Key Components**

The `TrieNode` class uses a JavaScript `Map` for children rather than a fixed-size array. This is intentional — a `Map` supports any Unicode character as a key, making the trie work for multi-language inputs without modification. The `topSuggestions` array is the heart of the optimization: it stores precomputed results so that serving a query is a simple lookup rather than a subtree traversal.

The `AutocompleteTrie.buildTopKCache` method performs a recursive depth-first traversal. At each node, it collects all complete queries in the subtree (those where `isEndOfQuery` is true), sorts them by frequency, and caches the top K. The recursion naturally propagates candidates upward: a parent node's candidate list is the union of its own query (if any) and all children's candidates. This is an O(N * K * log K) operation where N is the number of nodes, run once during trie construction — never during serving.

The `QueryAggregator` class simulates the offline pipeline. The `computeWeightedFrequencies` method applies exponential decay: `Math.exp(-lambda * ageDays)` ensures that recent queries have weight close to 1.0 while older queries decay toward 0. The `buildTrie` method chains the aggregation and trie construction together, mimicking the Spark job that runs periodically in production.

The `PrefixCache` leverages JavaScript's `Map` insertion-order guarantee for LRU semantics. When an entry is accessed (via `get`), it is deleted and re-inserted at the end of the Map. When the cache is full, the oldest entry (first in insertion order) is evicted. The `cleanup` method removes entries that have exceeded their TTL, called on a periodic timer.

The `ContentFilter` class implements both the offensive content blocklist and the right-to-be-forgotten deletion list. The `filter` method runs in the serving path, applied after trie lookup but before returning results to the client. In production, the blocklist check would use a more efficient data structure (a Bloom filter for probabilistic pre-screening, followed by exact hash set lookup for positives).

The HTTP server in `AutocompleteServer` demonstrates the full serving flow: parse the prefix from the query string, check the cache, fall back to the trie, apply filtering, store in cache, and return JSON. The `Cache-Control` header is set dynamically based on prefix length — shorter prefixes are more cacheable because they are shared across more users.

---

### Section 12 — Connection to Next Topic

In this topic, we designed a system that helps users find what they are looking for before they even finish typing. The autocomplete system sits at the entry point of the search experience: it observes what users want, predicts their intent from partial input, and guides them to the right query. But there is a prerequisite that we have taken for granted throughout this discussion — the search engine must already know about the content that exists on the web. How does it discover billions of web pages, videos, documents, and images in the first place?

That is the problem addressed in **Topic 49: Design a Web Crawler**. While the autocomplete system works with the demand side of search (what users are looking for), the web crawler works on the supply side (what content is available to be found). A web crawler systematically traverses the internet, following links from page to page, downloading content, and feeding it into the indexing pipeline that powers the search engine's results. Without the crawler, the search engine would have nothing to suggest and nothing to return.

The architectural themes carry over naturally. Just as autocomplete requires a data pipeline (query logs aggregated into a trie), the web crawler requires a data pipeline (discovered URLs scheduled for fetching, fetched pages parsed for links and content). Just as autocomplete must handle massive scale (billions of keystrokes per day), the crawler must handle massive scale (billions of web pages to discover and re-crawl). And just as autocomplete must balance freshness with efficiency (how often to rebuild the trie), the crawler must balance freshness with politeness (how often to re-crawl a page without overloading the host server). The transition from "helping users find content" to "discovering all the content in the world" is a natural progression in understanding the full search stack.

---

*Next up — Topic 49: Design a Web Crawler, where we move from the search box to the open web, building a system that systematically discovers, fetches, and catalogs billions of pages.*

---

<!--
Topic: 49
Title: Design a Web Crawler
Section: 10 — Real-World Designs Part 2
Track: 0-to-100 Deep Mastery
Difficulty: mid-senior
Interview Weight: medium
Prerequisites: Topics 1-3, 6, 10, 25
Next Topic: Topic 50 (Design a Video Streaming Platform)
Version: 1.0
Last Updated: 2025-05-15
-->

## Topic 49: Design a Web Crawler

---

### Section 1 — Why This Design?

In the summer of 1993, Matthew Gray at MIT launched the World Wide Web Wanderer, arguably the first web crawler ever built. Its original mission was modest: measure the growth of the nascent World Wide Web by counting active servers. The web at that time consisted of roughly 130 websites. The Wanderer would visit known URLs, record what it found, and move on. It was primitive, single-threaded, and ran on a single workstation — yet it planted the seed for one of the most consequential distributed systems in computing history.

Five years later, in a Stanford dorm room, Larry Page and Sergey Brin built a crawler they initially called BackRub, which eventually became Googlebot — the heart of the Google search engine. Their key insight was not just to crawl, but to analyze the link structure of the web itself, treating hyperlinks as votes of confidence. Googlebot had to be fast enough to keep up with the exponential growth of the web, polite enough not to crash the servers it visited, and intelligent enough to prioritize the most important pages. That same fundamental design challenge persists today: Google crawls hundreds of billions of pages, re-visiting popular sites every few minutes and obscure corners of the web every few weeks.

Web crawlers do not serve search engines alone. The Internet Archive's Wayback Machine has been crawling the web since 1996, preserving snapshots of pages for historical record. As of today, it has archived over 800 billion web pages. Common Crawl, a nonprofit, performs monthly crawls of the open web and makes the resulting datasets freely available — each monthly crawl contains petabytes of raw HTML, metadata, and extracted text, powering academic research and AI model training worldwide. Web crawlers also power price comparison engines, SEO analytics tools, news aggregators, and compliance monitoring systems.

From a system design interview perspective, "Design a Web Crawler" is a gold-standard question because it forces a candidate to grapple with nearly every hard problem in distributed systems simultaneously. You must reason about massive parallelism (thousands of fetcher threads across hundreds of machines), deduplication at scale (billions of URLs, many of which are duplicates), politeness constraints (rate limiting per domain), fault tolerance (what happens when a crawler node dies mid-crawl), storage (petabytes of raw content), and real-time prioritization (which pages deserve a re-crawl right now). There is no single "correct" architecture — the interviewer wants to see how you navigate trade-offs, estimate resource requirements, and evolve a design from simple to production-grade. This topic equips you to do exactly that.

---

### Section 2 — Requirements Gathering

Every system design interview should begin by clarifying what the system actually needs to do. Jumping straight into architecture without nailing down requirements is the single most common reason candidates produce weak designs. For a web crawler, the requirements split naturally into what the system does (functional) and how well it does it (non-functional).

#### Functional Requirements

The crawler must be able to discover and download web pages at scale, starting from a set of seed URLs and following hyperlinks to discover new pages. Specifically:

1. **Crawl billions of web pages** across the public internet, starting from seed URLs and recursively following discovered links.
2. **Extract and store content** — download the raw HTML (and optionally rendered content), store it durably, and make it available for downstream consumers like indexers or analytics pipelines.
3. **Follow links** — parse each downloaded page, extract all outbound hyperlinks, and add newly discovered URLs to the crawl queue.
4. **Respect robots.txt** — before crawling any domain, fetch and parse its `/robots.txt` file. Honor disallow directives, crawl-delay specifications, and sitemap references.
5. **Handle different content types** — the web is not just HTML. The crawler encounters PDFs, images, JavaScript-rendered single-page applications, XML feeds, and binary files. It must gracefully handle or skip non-HTML content based on configuration.
6. **URL normalization and deduplication** — treat `http://example.com`, `http://www.example.com/`, and `http://EXAMPLE.COM` as the same URL. Avoid crawling duplicate pages.

#### Non-Functional Requirements

1. **Politeness** — the crawler must not overwhelm any individual web server. This means enforcing per-host rate limits (typically no more than one request per second to a given host) and respecting any `Crawl-delay` directives in robots.txt.
2. **Scalability** — the system must scale to crawl at least 1 billion pages per month, with the architecture supporting horizontal scaling to handle 10x or 100x growth.
3. **Freshness** — important pages (major news sites, popular e-commerce catalogs) should be re-crawled frequently (minutes to hours), while less important pages can be re-crawled on a weekly or monthly cycle.
4. **Fault tolerance** — individual node failures must not cause data loss or halt the crawl. The system should checkpoint its state and recover gracefully.
5. **Extensibility** — it should be straightforward to add new content processors (e.g., a module that extracts structured data from product pages) without redesigning the core crawl loop.

#### Back-of-Envelope Estimation

These calculations are essential in interviews. They ground your architecture in reality and demonstrate that you think quantitatively.

**Target**: 1 billion pages per month.

```
Pages per month:       1,000,000,000
Pages per day:         1B / 30           = ~33,333,333 pages/day
Pages per second:      33.3M / 86,400    = ~386 pages/second (QPS)
```

That is roughly 400 pages per second sustained. A single machine with 100 concurrent fetcher threads, each completing a page every 2 seconds, handles about 50 pages/second. So we need approximately **8 crawler machines** for fetching alone — but in practice, we add a 3-5x safety margin for DNS resolution delays, slow servers, retries, and headroom, arriving at **25-40 fetcher machines**.

**Storage estimation**:

```
Average page size (raw HTML):   500 KB
Total raw storage per month:    1B * 500 KB = 500 TB/month
With metadata overhead (~20%):  ~600 TB/month
Compressed (gzip ~5:1 ratio):   ~120 TB/month of compressed storage
```

Over a year, that is 1.44 PB of compressed crawl data. This is a serious storage requirement that demands a distributed storage layer — think HDFS, S3, or a similar object store.

**Bandwidth estimation**:

```
500 KB/page * 386 pages/sec = 193 MB/sec = ~1.5 Gbps sustained download bandwidth
```

That is well within the capacity of modern data center networking, but it means each fetcher machine needs a reliable 50-100 Mbps link at minimum.

**URL frontier size**: If the average page contains 50 outbound links, crawling 1B pages discovers 50B link references. After deduplication, perhaps 5-10B unique URLs accumulate in the frontier over time. Storing each URL as a 100-byte normalized string requires 500 GB to 1 TB just for the URL frontier — this must be distributed.

**DNS lookups**: Every new domain requires a DNS resolution. With millions of unique domains, DNS can become a bottleneck unless we aggressively cache results. A local DNS cache with a 24-hour TTL dramatically reduces external DNS traffic.

---

### Section 3 — High-Level Architecture

A web crawler is fundamentally a loop: pick a URL, fetch it, extract links, add new URLs back to the queue, repeat. The challenge is executing this loop billions of times per month across a distributed cluster while maintaining politeness, avoiding duplicates, and handling failures. Here is the high-level architecture:

```
                         +------------------+
                         |   Seed URLs      |
                         +--------+---------+
                                  |
                                  v
                    +-------------+-------------+
                    |       URL Frontier         |
                    |  (Priority + Politeness    |
                    |   Queues)                  |
                    +-------------+-------------+
                                  |
                          +-------+-------+
                          |               |
                          v               v
                   +-----------+   +-----------+
                   | Fetcher   |   | Fetcher   |  ... (N fetcher workers)
                   | Worker 1  |   | Worker 2  |
                   +-----------+   +-----------+
                          |               |
                          v               v
                    +-------------+-------------+
                    |     DNS Resolver Cache     |
                    +---------------------------+
                                  |
                                  v
                    +---------------------------+
                    |   robots.txt Cache &      |
                    |   Compliance Checker      |
                    +---------------------------+
                                  |
                                  v
                    +---------------------------+
                    |     Content Parser &      |
                    |     Extractor             |
                    +---------------------------+
                         |              |
                         v              v
              +----------------+  +------------------+
              | Link Extractor |  | Content Storage  |
              | & URL          |  | (S3 / HDFS)      |
              | Normalizer     |  +------------------+
              +-------+--------+
                      |
                      v
              +------------------+
              |  URL Dedup       |
              |  (Bloom Filter)  |
              +-------+----------+
                      |
                      | (new URLs only)
                      v
              +------------------+
              |  URL Frontier    | <--- feeds back into the loop
              +------------------+
```

**Component responsibilities**:

The **URL Frontier** is the brain of the crawler. It is not a simple queue — it is a sophisticated priority system that decides which URL to fetch next, while enforcing per-host rate limits to ensure politeness. The frontier accepts new URLs from the link extractor and deduplication layer, scores them by priority, and hands them to fetcher workers when the target host is not currently being rate-limited.

**Fetcher Workers** are the muscle. Each worker pulls a URL from the frontier, resolves its DNS, checks robots.txt compliance, makes the HTTP request, and passes the response to the content parser. Workers run in parallel — dozens or hundreds per machine, across many machines. They must handle timeouts, redirects, retries, and various HTTP error codes gracefully.

The **DNS Resolver Cache** prevents DNS from becoming a throughput bottleneck. Instead of hitting external DNS servers for every request, the crawler maintains a local cache. DNS resolutions are relatively slow (50-200ms for uncached lookups), and at 400 QPS, those milliseconds add up fast.

The **robots.txt Cache** stores parsed robots.txt files for each domain. Before any fetch, the system checks whether the target URL is allowed. The cache refreshes periodically (every 24 hours per domain) to pick up policy changes.

The **Content Parser** extracts useful information from downloaded pages: the raw text, metadata (title, description, language), and outbound links. For JavaScript-heavy sites, it may invoke a headless browser (like Puppeteer) to render the page before extraction.

The **Link Extractor and URL Normalizer** parses all `<a href="...">` tags, resolves relative URLs to absolute ones, normalizes them (lowercase hostname, remove fragments, sort query parameters), and passes them to the deduplication layer.

The **URL Deduplication** layer (typically a bloom filter) checks whether a URL has already been seen. If yes, it is discarded. If no, it is added to the frontier. This prevents the crawler from re-fetching pages it has already downloaded.

**Content Storage** is the final destination for crawled content. Raw HTML, extracted text, and metadata are stored in a distributed object store (S3, HDFS, or a similar system), indexed by URL and crawl timestamp.

---

### Section 4 — Deep Dive: URL Frontier

The URL frontier is the most intellectually interesting component of a web crawler, and it is the component interviewers most want you to discuss in depth. A naive approach — a single FIFO queue — fails immediately at scale for two reasons: it cannot express priority (a New York Times homepage should be crawled before a random blog post from 2008), and it cannot enforce politeness (you must not send 100 requests per second to the same domain).

#### The Mercator Architecture

The seminal design for a web crawler frontier comes from the Mercator paper (Heydon and Najork, 1999), which introduced a two-level queue architecture: **front queues** for priority and **back queues** for politeness.

```
  Incoming URLs (from link extractor + dedup)
           |
           v
  +-------------------+
  | Priority Assigner |  (assigns each URL a priority score)
  +-------------------+
           |
           v
  +--------+--------+--------+
  | Front  | Front  | Front  |  ... F front queues
  | Queue  | Queue  | Queue  |     (one per priority level)
  |  (P1)  |  (P2)  |  (P3)  |
  +--------+--------+--------+
           |
           v
  +-------------------+
  | Front Queue       |
  | Selector          |  (biased selection: higher priority
  +-------------------+   queues polled more frequently)
           |
           v
  +--------+--------+--------+--------+
  | Back   | Back   | Back   | Back   | ... B back queues
  | Queue  | Queue  | Queue  | Queue  |    (one per host)
  | host-a | host-b | host-c | host-d |
  +--------+--------+--------+--------+
           |
           v
  +-------------------+
  | Back Queue        |
  | Selector          |  (picks a queue whose host is not
  +-------------------+   rate-limited right now)
           |
           v
     Fetcher Worker
```

**Front queues (priority)**. There are F front queues, each corresponding to a priority level. When a new URL arrives, the priority assigner computes a score based on factors like the page's estimated importance (derived from the number of inbound links, domain authority, or historical PageRank), the content type (HTML pages rank higher than images), and the freshness requirement (pages that change frequently get higher priority for re-crawls). The URL is then placed into the front queue matching its priority level. A front queue selector draws URLs from these queues with a bias toward higher-priority queues — for instance, 50% of selections come from P1, 30% from P2, and 20% from P3.

**Back queues (politeness)**. There are B back queues, each mapped to a specific hostname (or a small set of hostnames). When a URL exits a front queue, it is routed to the back queue corresponding to its host. Each back queue maintains a "next allowed fetch time" — the earliest timestamp at which a request to that host is permitted. This is typically set to one second after the last request to that host, unless robots.txt specifies a longer crawl delay. The back queue selector scans back queues and picks one whose next-allowed-fetch-time has passed. If no queue is ready, the selector waits.

This two-level design cleanly separates the two concerns. Front queues handle *what* to crawl next (priority), and back queues handle *when* it is safe to crawl (politeness). The Mercator paper demonstrated that this architecture scales efficiently and prevents the "thundering herd" problem where a burst of discovered links from a single domain causes a storm of requests to that domain.

#### Priority Scoring

The priority assigned to a URL is critical to crawl efficiency. In a system crawling billions of pages but with finite resources, priority determines which fraction of the web you actually cover within any given time window. Common scoring signals include:

- **PageRank or link-based authority**: URLs with many inbound links from authoritative domains score higher. This can be approximated from previous crawl data.
- **Historical change frequency**: Pages that change often (news homepages, stock tickers) score higher for re-crawl priority.
- **Content type**: HTML pages score higher than images, PDFs, or binary files (unless the use case specifically targets those types).
- **URL depth**: URLs closer to the domain root (e.g., `example.com/products`) typically contain more important content than deeply nested URLs (e.g., `example.com/a/b/c/d/e/page`).
- **Domain importance**: A `.gov` or `.edu` domain may receive a baseline priority boost.

In practice, these signals are combined via a weighted scoring function, and the score maps to one of F discrete priority levels. The scoring function is tuned based on the crawler's use case — a news crawler will weight freshness heavily, while an archival crawler will weight coverage breadth.

#### Persistence and Recovery

The URL frontier at scale can contain billions of entries. It cannot live entirely in memory. Production crawlers typically use a combination of in-memory buffers for the hot working set (the front/back queue heads) and on-disk storage (often a RocksDB or LevelDB instance) for the bulk of queued URLs. Periodic checkpoints of the frontier state to durable storage allow recovery after crashes — the crawler can resume from its last checkpoint rather than re-discovering all URLs from scratch.

---

### Section 5 — Content Processing

Once a fetcher worker downloads a page, the raw HTTP response enters the content processing pipeline. This is where the crawler transforms raw bytes into structured data that downstream consumers (search indexers, analytics engines, ML pipelines) can use.

#### HTML Parsing and Content Extraction

The first step is parsing the HTML document into a DOM tree. Libraries like `cheerio` (Node.js), `BeautifulSoup` (Python), or `jsoup` (Java) handle this efficiently. From the DOM, the crawler extracts:

- **Title**: from the `<title>` tag.
- **Meta description**: from `<meta name="description" content="...">`.
- **Body text**: the visible text content, stripped of HTML tags, navigation boilerplate, ads, and scripts. Production systems use readability heuristics or machine learning models to distinguish main content from chrome.
- **Structured data**: JSON-LD, microdata, or RDFa embedded in the page, which provides machine-readable metadata about products, articles, events, and more.
- **Links**: all `<a href="...">` tags, `<link>` tags, and URLs referenced in `<img>`, `<script>`, and `<iframe>` elements.

The quality of content extraction directly impacts downstream use. A search engine that indexes navigation menus and footer text alongside article body text will produce noisy search results. Sophisticated crawlers therefore invest heavily in "boilerplate removal" — algorithms that identify and strip repeated template elements across pages from the same domain.

#### Handling JavaScript-Rendered Pages

The modern web increasingly relies on client-side JavaScript to render content. A traditional crawler that only downloads raw HTML will see an empty `<div id="root"></div>` for a React, Angular, or Vue single-page application. This is a significant challenge.

The solution is **headless browser rendering**. Tools like Puppeteer (headless Chrome) or Playwright can load a page, execute its JavaScript, wait for content to render, and then extract the fully-rendered DOM. However, headless rendering is expensive: it consumes 10-50x more CPU and memory than a simple HTTP fetch, and it takes 2-10 seconds per page instead of 200-500 milliseconds. At scale, this means only a fraction of pages can receive headless rendering.

Production crawlers use a tiered approach. First, fetch the raw HTML. If the page appears to be JavaScript-rendered (e.g., the body is suspiciously small, or the domain is known to use a SPA framework), route it to a headless rendering cluster. Otherwise, process the raw HTML directly. This keeps costs manageable while ensuring JavaScript-heavy sites are still crawled effectively. Google's own crawler has evolved to include a rendering service (the "Web Rendering Service") that processes JavaScript for pages that require it.

#### Robots.txt Parsing and Compliance

Before fetching any page on a domain, the crawler must check that domain's `/robots.txt` file. This file specifies which paths the crawler may or may not access, and optionally a crawl delay. A well-behaved crawler treats robots.txt as law, not suggestion.

Parsing robots.txt is straightforward but has edge cases. The file uses a simple directive format (`User-agent`, `Disallow`, `Allow`, `Crawl-delay`, `Sitemap`), but different crawlers handle wildcard patterns and precedence rules differently. Google's specification (the de facto standard) allows `*` and `$` wildcards in path patterns and uses a longest-match rule for conflicting Allow/Disallow directives.

The crawler caches parsed robots.txt files per domain, refreshing them periodically (typically every 24 hours). The cache must be consulted before every fetch, so it sits in the hot path and must be fast — an in-memory hash map keyed by domain name works well.

#### Sitemap.xml Processing

Many websites provide a `sitemap.xml` file (often referenced in robots.txt) that lists all URLs the site owner wants crawlers to discover. This is a valuable signal — it shortcuts the link-discovery process and can indicate page priority and last-modified timestamps. The crawler should parse sitemaps and feed discovered URLs into the frontier, with priority adjusted based on the sitemap's `<priority>` and `<lastmod>` fields.

#### URL Canonicalization

The same logical page can have many URL representations. URL canonicalization reduces these to a single canonical form to avoid duplicate crawling:

- **Protocol normalization**: `http://` vs `https://` — modern crawlers may treat these as the same if the HTTP version redirects to HTTPS.
- **Hostname normalization**: `www.example.com` vs `example.com` — lowercase, remove default port numbers (`:80` for HTTP, `:443` for HTTPS).
- **Path normalization**: remove trailing slashes, resolve `.` and `..` segments, decode unnecessary percent-encoding (`%7E` becomes `~`).
- **Query parameter normalization**: sort query parameters alphabetically, remove tracking parameters (`utm_source`, `utm_medium`, etc.) that do not affect content.
- **Fragment removal**: the `#section` fragment is never sent to the server, so it should always be stripped.

Proper canonicalization is critical. Without it, a bloom filter will fail to detect duplicates, and the crawler will waste resources re-fetching the same content under different URL spellings.

---

### Section 6 — URL Deduplication

At the scale of billions of URLs, deduplication is not a nice-to-have — it is essential for the crawler's survival. Without deduplication, the crawler will spiral into infinite re-crawling loops, wasting bandwidth, storage, and compute on pages it has already seen.

#### Why Naive Approaches Fail

The obvious approach — store every seen URL in a hash set and check membership before adding a new URL — works perfectly at small scale. But consider the numbers: 5 billion unique URLs, each averaging 100 bytes. A simple hash set in memory requires at minimum 500 GB for the URLs alone, plus overhead for the hash table structure (pointers, load factor padding), pushing well past 1 TB. No single machine can hold this in RAM cost-effectively. A disk-backed hash set works but is slow — each membership check requires a disk seek, and at 400 URLs/second, the latency adds up.

You could use a database (e.g., a distributed key-value store like Redis or Cassandra) to store seen URLs. This works but is expensive — 5 billion keys in Redis requires hundreds of GB of RAM across many nodes, and Cassandra introduces disk I/O latency. For a membership-check-only workload, we can do much better.

#### Bloom Filters

A bloom filter is a probabilistic data structure that answers the question "have I seen this element before?" with guaranteed no false negatives and a controllable false positive rate. It uses a bit array of size `m` and `k` hash functions. To add an element, hash it `k` times and set the corresponding bits. To check membership, hash the element `k` times and check if all corresponding bits are set.

**Why this is ideal for URL deduplication**: We can tolerate a small false positive rate (e.g., 1%). A false positive means we skip a URL we have not actually crawled — a minor loss. A false negative (thinking we have not seen a URL when we have) would cause duplicate crawling — bloom filters guarantee this never happens.

**Memory estimation for a bloom filter**:

The optimal bit array size for `n` elements with false positive rate `p` is:

```
m = -(n * ln(p)) / (ln(2))^2
```

For `n = 5 billion` URLs and `p = 0.01` (1% false positive rate):

```
m = -(5 * 10^9 * ln(0.01)) / (ln(2))^2
m = -(5 * 10^9 * (-4.605)) / (0.4805)
m = 23.025 * 10^9 / 0.4805
m ≈ 47.9 * 10^9 bits
m ≈ 5.99 GB
```

The optimal number of hash functions:

```
k = (m/n) * ln(2) = (47.9 * 10^9 / 5 * 10^9) * 0.693 ≈ 6.64 ≈ 7
```

So a **6 GB bloom filter with 7 hash functions** can track 5 billion URLs with only a 1% false positive rate. This fits comfortably in the RAM of a single machine. Compare this to the 500+ GB needed for a hash set — bloom filters reduce memory requirements by nearly 100x.

#### URL Normalization Before Hashing

Before inserting a URL into the bloom filter, it must be normalized (as described in the canonicalization section). If `http://example.com/page` and `http://EXAMPLE.COM/page/` are hashed without normalization, they produce different bloom filter entries, defeating deduplication. The normalization step is therefore part of the bloom filter's logical interface, not a separate concern.

#### Checkpointing Bloom Filter State

If a crawler node crashes, its in-memory bloom filter is lost. To avoid re-crawling millions of already-seen URLs, the bloom filter must be checkpointed to durable storage periodically. A snapshot every 10-30 minutes strikes a reasonable balance between recovery granularity and I/O overhead. The bit array is highly compressible (it is mostly zeros for low-fill-ratio filters), so serialization and storage are efficient.

#### Distributed Bloom Filters

When the crawl operation spans multiple machines, each machine can maintain its own local bloom filter for the URL partition it is responsible for (using consistent hashing to assign URL ranges to machines). Alternatively, a shared bloom filter can be stored in a fast distributed cache like Redis (which natively supports bit operations). The choice depends on the coordination model: partitioned bloom filters are faster (no network round-trip for checks) but require that URL routing is deterministic; a shared bloom filter is simpler but introduces a network dependency on the check path.

---

### Section 7 — Scaling the Crawler

A single-machine crawler with 100 threads can handle perhaps 50 pages per second — enough for a small-scale research crawl but nowhere near the 400+ pages/second needed for our 1B pages/month target. Scaling requires distributing the work across a cluster of machines, and this introduces a host of coordination challenges.

#### Distributed Architecture

The standard approach divides the crawl space by domain. A **URL router** uses consistent hashing on the hostname to assign each URL to a specific crawler node. This ensures that all URLs for `example.com` are handled by the same node, which in turn ensures that per-host politeness constraints (rate limiting) are enforced locally without cross-node coordination. Each node runs its own URL frontier (with front and back queues), fetcher workers, content parser, and local bloom filter partition.

```
                   +------------------+
                   |  URL Router      |
                   |  (Consistent     |
                   |   Hashing)       |
                   +--------+---------+
                            |
           +----------------+----------------+
           |                |                |
           v                v                v
   +-------+------+  +-----+--------+  +----+---------+
   | Crawler      |  | Crawler      |  | Crawler      |
   | Node 1       |  | Node 2       |  | Node 3       |
   | (hosts a-f)  |  | (hosts g-m)  |  | (hosts n-z)  |
   +--------------+  +--------------+  +--------------+
```

When a node discovers a URL for a host that maps to a different node, it sends that URL to the responsible node via a message queue or RPC call. This cross-node communication is the primary coordination overhead in a distributed crawler.

#### DNS Caching

DNS resolution is a surprisingly critical bottleneck. Each unique domain requires at least one DNS lookup, and standard DNS resolution takes 50-200ms. At scale, the crawler encounters millions of unique domains. Without caching, DNS lookups alone would consume a significant fraction of crawl latency.

The solution is a multi-tier DNS cache. Each crawler node runs a local DNS cache (e.g., `dnsmasq` or a custom in-memory cache) with a TTL of 24 hours for successful lookups and 1 hour for failed lookups (NXDOMAIN). For cache misses, the node queries an organizational DNS resolver (which itself caches aggressively) before falling back to upstream DNS servers. This architecture reduces external DNS traffic by 95% or more.

#### Connection Pooling and HTTP Keep-Alive

Establishing a new TCP connection for every HTTP request is wasteful. The TCP handshake adds one round-trip time of latency, and TLS negotiation (for HTTPS) adds another one to two round-trips. At 400 requests/second, these milliseconds compound into significant throughput loss.

HTTP keep-alive (persistent connections) allows the crawler to reuse TCP connections for multiple requests to the same host. Connection pooling maintains a pool of open connections per host, ready for reuse. Combined with the per-host back queue architecture (which batches requests to the same host), connection pooling can reduce per-request latency by 30-50% for frequently crawled domains.

#### Handling Slow and Hanging Servers

The internet is not a controlled environment. Some servers are slow, some are misconfigured, and some actively resist crawling by responding with deliberate delays. Without proper timeout handling, a few slow servers can consume all fetcher threads, stalling the entire crawler.

Effective timeout configuration includes:

- **Connection timeout**: 10-15 seconds. If the TCP connection is not established within this window, abort and move on.
- **Read timeout**: 30 seconds. If no data arrives within 30 seconds after the connection is established, abort.
- **Total request timeout**: 60 seconds. Even if data is trickling in slowly, cap the total time spent on any single page.
- **Maximum response size**: 10 MB. Some pages (or malicious servers) will send enormous responses. Cap the download size to prevent memory exhaustion.

Fetcher threads that time out should release the URL back to the frontier with a penalty (reduced priority, or a backoff interval before retrying). After multiple failures, the URL is deprioritized or blacklisted.

#### Trap Detection

The web contains many traps — URL patterns that generate an infinite or near-infinite set of unique URLs, all pointing to essentially the same or meaningless content. Common traps include:

- **Calendar pages**: A page at `/calendar?year=2024&month=1` that links to `/calendar?year=2024&month=2`, which links to `/calendar?year=2024&month=3`, and so on. The crawler can follow these links forever.
- **Session IDs in URLs**: Some websites embed session identifiers in every URL (e.g., `/page?sid=abc123`), generating a unique URL for every visit.
- **Infinite depth paths**: A misconfigured server that adds path segments on every request (e.g., `/a/a/a/a/a/...`).
- **Query parameter variations**: Search result pages with `page=1`, `page=2`, ... `page=999999`.

Detection strategies include:

- **URL depth limit**: Do not crawl URLs with more than N path segments (typically 10-15).
- **Per-domain URL budget**: Limit the total number of URLs crawled per domain within a time window.
- **Pattern detection**: Identify URLs that differ only in a single numeric parameter and cap the number of such variations.
- **Content fingerprinting**: If multiple URLs from the same domain produce content with the same SimHash fingerprint, flag the domain as potentially trapping and reduce its crawl budget.

---

### Section 8 — Freshness and Re-Crawling

A crawl is never "done." The web is constantly changing — pages are updated, new pages are created, old pages are deleted. A crawler that only performs a single pass will quickly find its data stale. Re-crawling is how the system maintains freshness, and intelligent re-crawl scheduling is what separates a mediocre crawler from a great one.

#### Deciding When to Re-Crawl

The fundamental question is: given finite crawl capacity, which pages should be re-crawled, and how often? Crawling a page that has not changed since the last visit wastes bandwidth and compute. Crawling a page too infrequently means the stored version is stale. The goal is to minimize the "staleness gap" — the time between a page changing and the crawler discovering the change — while staying within resource constraints.

#### Frequency Estimation Based on Historical Change Rate

The most effective approach is to learn each page's change frequency from historical data. If a page has been crawled 10 times over the past month and changed 8 times, it likely changes frequently and deserves a high re-crawl frequency. If it changed only once, a lower frequency suffices.

Formally, this can be modeled as a Poisson process. If a page's change events follow a Poisson distribution with rate lambda, the optimal re-crawl interval is `1/lambda`. In practice, the crawler maintains a change counter and last-change timestamp for each URL and computes the estimated change rate as `changes / observation_period`. This rate is then used to set the next re-crawl time.

#### Adaptive Re-Crawl Scheduling

Rather than using a fixed interval, adaptive scheduling adjusts dynamically. If the crawler re-visits a page and finds it unchanged, it increases the interval (e.g., doubles it, up to a maximum). If it finds the page changed, it decreases the interval (e.g., halves it, down to a minimum). This exponential backoff/approach strategy converges on the optimal re-crawl frequency for each page without requiring explicit change rate modeling.

#### Priority-Based Re-Crawling

Not all pages deserve equal freshness. A major news site's homepage might need re-crawling every 5 minutes, while a personal blog's about page might be fine with a monthly check. Re-crawl priority is a composite of:

- **Page importance**: Measured by PageRank, traffic volume, or domain authority.
- **Estimated change rate**: Measured by historical observation as described above.
- **Content type**: News articles and product prices change more often than academic papers or legal documents.
- **User demand**: If a downstream consumer (search engine, analytics) specifically requests fresh data for certain URLs, those URLs get priority.

These signals feed into the priority assigner in the URL frontier, ensuring that high-value, frequently-changing pages are re-crawled first.

#### Incremental Crawling vs Full Re-Crawl

An **incremental crawl** revisits only pages that are likely to have changed, based on the adaptive scheduling above. This is efficient but risks missing changes on pages with low estimated change rates. A **full re-crawl** visits every known URL regardless of change predictions. This is thorough but expensive.

Production crawlers combine both approaches: a continuous incremental crawl runs constantly, prioritizing likely-changed pages, while a periodic full re-crawl (e.g., monthly) sweeps through the entire URL database to catch changes the incremental crawl missed and to discover new pages linked from previously static pages.

#### HTTP Conditional Requests

The HTTP protocol provides mechanisms for efficient re-crawling. The `If-Modified-Since` header allows the crawler to send the timestamp of its last visit; if the server knows the page has not changed since then, it responds with `304 Not Modified` (no body), saving bandwidth. Similarly, the `ETag` header provides a content fingerprint that the crawler can send with `If-None-Match` to check for changes.

Not all servers support conditional requests, but when they do, the bandwidth savings are substantial. A 304 response is typically less than 500 bytes, compared to the 500 KB average for a full page download. For pages that change infrequently, conditional requests can reduce re-crawl bandwidth by 90% or more.

---

### Section 9 — Trade-Offs and Design Decisions

Every design interview comes down to trade-offs. The interviewer wants to see that you understand there is no perfect solution, only a set of choices with different costs and benefits. Here are the key trade-offs in web crawler design.

#### Breadth-First vs Depth-First Crawling

**Breadth-first** starts at seed URLs and explores all links at the current depth before moving to the next depth level. This produces broad coverage quickly and tends to discover high-quality pages early (since they are usually reachable within a few hops from seed URLs). Most production crawlers use BFS or a priority-weighted variant of it.

**Depth-first** follows links as deeply as possible before backtracking. This can be useful for targeted crawls (e.g., crawling a specific site exhaustively) but is dangerous for general-purpose crawling because it can get trapped in a single deep site while ignoring the rest of the web. Depth-first crawling also makes it harder to enforce per-host politeness because the crawler tends to concentrate requests on a single host for extended periods.

The practical choice is a **priority-weighted breadth-first** approach, where the URL frontier's priority scoring naturally biases toward breadth (high-authority pages discovered early) while allowing targeted depth when content importance warrants it.

#### Politeness vs Speed

More aggressive crawling (shorter delays between requests to the same host, more concurrent connections) achieves higher throughput but risks being blocked by web servers, causing denial-of-service conditions on small sites, and violating community norms. Conservative politeness (strict rate limiting, long delays) protects web servers but reduces crawl speed.

The standard practice is to default to one request per second per host (or per the robots.txt `Crawl-delay` directive) and to limit concurrent connections to 1-2 per host. Some crawlers negotiate faster rates with webmasters who opt in (e.g., by specifying a short Crawl-delay in robots.txt).

#### Freshness vs Coverage

Given finite resources, you can either cover more pages (breadth) or keep fewer pages more up-to-date (freshness). A news search engine prioritizes freshness — re-crawling major news sites every few minutes. A comprehensive web archive like the Wayback Machine prioritizes coverage — crawling as many unique URLs as possible, even if some data is weeks old.

The right balance depends on the use case. In an interview, acknowledge both extremes and explain how the priority scoring system in the URL frontier lets you tune the freshness-coverage tradeoff by adjusting the weights on change-rate versus discovery-novelty signals.

#### Store Raw HTML vs Extracted Text

Storing raw HTML preserves maximum information — you can re-parse it later if extraction algorithms improve. But it costs 5-10x more storage than extracted text alone. Storing only extracted text saves space but is lossy — you cannot retroactively extract new fields from pages you have already processed.

Most production systems store both: raw HTML in a compressed object store (cheap, write-once-read-rarely) and extracted structured data in a database or index (expensive, read-frequently). This gives the best of both worlds at the cost of storage complexity.

#### Centralized vs Distributed URL Frontier

A **centralized frontier** (one master node managing the priority/politeness queues) is simpler to implement and reason about but is a single point of failure and a throughput bottleneck. A **distributed frontier** (each crawler node manages its own frontier for the hosts assigned to it) scales better but complicates cross-node URL routing and makes global priority ordering approximate rather than exact.

For the 1B pages/month target, a distributed frontier with consistent hashing is the right choice. The loss of global priority precision is a worthwhile trade-off for the scalability and fault tolerance it provides.

#### Headless Rendering vs Static HTML Only

As discussed in the content processing section, headless rendering captures JavaScript-rendered content but is 10-50x more expensive. Rendering every page is infeasible at scale. The practical compromise is selective rendering: render only pages that are detected or known to require JavaScript, and process everything else as static HTML. This keeps costs manageable while covering the JavaScript-heavy fraction of the web.

---

### Section 10 — Interview Questions

The following questions are organized by difficulty tier. Each includes a model answer that demonstrates the depth of reasoning an interviewer expects.

#### Beginner Tier

**Q1: What is the basic loop of a web crawler, and what are its main components?**

A web crawler follows a repeated cycle: pick a URL from the queue, download the page, extract links from the downloaded content, add new links back to the queue, and store the page content. The main components are the URL frontier (a queue that manages which URLs to crawl next), fetcher workers (threads or processes that make HTTP requests to download pages), a content parser (which extracts text and links from the HTML), a URL deduplication system (which prevents re-crawling pages already visited), and a content store (which persists the downloaded data). The frontier is not a simple FIFO queue in production systems — it incorporates priority scoring so important pages are crawled first, and per-host rate limiting so the crawler does not overwhelm any single web server. Even at this basic level, understanding that the frontier must balance priority against politeness is the key insight that separates a passing answer from a strong one.

**Q2: Why do we need to respect robots.txt, and what happens if we ignore it?**

Robots.txt is a voluntary standard (the Robots Exclusion Protocol) that allows website owners to communicate crawling preferences to automated agents. It specifies which paths on a site may or may not be crawled, and optionally how fast the crawler may operate (via Crawl-delay). Ignoring robots.txt has several consequences. First, it is a violation of internet community norms — most search engines and crawlers treat it as a binding directive. Second, the crawler's IP addresses may be blocked by the target server, degrading crawl effectiveness. Third, crawling disallowed paths may expose private or sensitive content (like admin panels or internal APIs) that the site operator explicitly did not want indexed. Fourth, in some jurisdictions, ignoring robots.txt has been cited in legal proceedings as evidence of unauthorized access. A well-designed crawler fetches and caches robots.txt for each domain before any content requests, checks every URL against the cached directives, and refreshes the cache periodically (every 24 hours is standard).

**Q3: What is a bloom filter, and why is it used in web crawlers?**

A bloom filter is a space-efficient probabilistic data structure that tests whether an element is a member of a set. It can produce false positives (claiming an element is in the set when it is not) but never false negatives (it will never miss an element that is actually in the set). Web crawlers use bloom filters for URL deduplication — determining whether a newly discovered URL has already been seen. At the scale of billions of URLs, a traditional hash set would require hundreds of gigabytes of memory. A bloom filter tracking 5 billion URLs with a 1% false positive rate requires only about 6 GB of memory — roughly 100x more efficient. The trade-off is the false positive rate: about 1% of new URLs will be incorrectly classified as "already seen" and skipped. This is an acceptable loss because missing 1% of URLs has minimal impact on crawl coverage, while the memory savings are enormous. The false positive rate can be tuned by adjusting the size of the bit array and the number of hash functions.

#### Mid-Level Tier

**Q4: How would you design the URL frontier to balance priority and politeness?**

The URL frontier should use the Mercator two-level architecture. The first level consists of F front queues, one per priority tier. Incoming URLs are scored (based on PageRank, change frequency, content type, URL depth) and placed into the appropriate front queue. A selector draws URLs from front queues with probability proportional to their priority level. The second level consists of B back queues, one per hostname (or hostname group). Each back queue enforces per-host rate limiting by maintaining a "next allowed fetch time" — typically set to max(1 second, robots.txt Crawl-delay) after the last request to that host. URLs flow from front queues to back queues based on their hostname. A fetcher worker requests a URL from the back queue selector, which returns a URL from a back queue whose rate limit has expired. This two-level structure cleanly separates "what to crawl" (priority, handled by front queues) from "when to crawl" (politeness, handled by back queues). For scalability, the frontier is distributed: consistent hashing maps each hostname to a specific crawler node, so all URLs for a domain reside on one node's frontier, and per-host rate limiting requires no cross-node coordination.

**Q5: How would you handle JavaScript-rendered single-page applications?**

The crawler should implement a two-phase approach. In the first phase, every URL is fetched via a standard HTTP GET and the raw HTML is parsed. If the HTML contains substantive content (the body text exceeds a configurable threshold, e.g., 500 characters), it is processed normally. If the page appears to be a JavaScript-rendered SPA (near-empty body, large inline script bundles, known SPA framework markers like `<div id="root"></div>`), it is flagged for the second phase. In the second phase, the URL is sent to a headless rendering cluster running Puppeteer or Playwright, which loads the page in a real browser context, executes JavaScript, waits for the DOM to stabilize (e.g., using a network-idle heuristic), and then extracts the rendered HTML. Rendered content is sent back to the standard content processing pipeline. The key constraint is cost: headless rendering is 10-50x more expensive than static fetching. Therefore, the crawler should maintain a domain-level classification (SPA vs static) and route entire domains to the appropriate pipeline rather than making per-URL decisions. Over time, this classification can be learned from data, further reducing unnecessary rendering.

**Q6: Explain how you would detect and handle crawler traps.**

Crawler traps are URL patterns that generate a near-infinite set of unique URLs pointing to duplicate or useless content. Detection requires multiple strategies applied in combination. First, enforce a maximum URL depth limit (e.g., 15 path segments) — this catches infinite depth paths. Second, enforce a per-domain URL budget (e.g., no more than 50,000 URLs per domain per crawl cycle) — this prevents any single domain from consuming disproportionate crawl resources. Third, implement pattern detection: when the crawler discovers many URLs from the same domain that differ only in a single query parameter or path segment (e.g., `/page/1`, `/page/2`, ..., `/page/99999`), it should cap the number of variations crawled (e.g., 100) and deprioritize the rest. Fourth, use content fingerprinting: compute a SimHash of each downloaded page's content, and if multiple URLs from the same domain produce identical or near-identical content hashes, flag the domain as a potential trap and reduce its budget further. Fifth, maintain a curated blacklist of known trap patterns (e.g., domains that generate calendar pages infinitely). The key principle is defense in depth — no single detection method catches all traps, so layering multiple strategies provides robust protection.

#### Senior Tier

**Q7: Design a freshness optimization strategy that minimizes staleness across the entire crawl while staying within a fixed QPS budget.**

This is an optimization problem. Define staleness for a page as the time elapsed since the page last changed while the crawler's copy is outdated. The total staleness across the corpus is the sum of per-page staleness, and we want to minimize it subject to the constraint that the total re-crawl rate does not exceed Q pages per second. Model each page `i` as having a change rate `lambda_i` (estimated from historical data). The optimal re-crawl rate for page `i` is proportional to `sqrt(lambda_i)` — pages that change more often should be re-crawled more often, but with diminishing returns. Specifically, allocate re-crawl rate `r_i = Q * sqrt(lambda_i) / sum(sqrt(lambda_j))` for all pages `j`. This is derived from the Lagrangian optimization of the staleness function. In practice, the crawler maintains a change-rate estimate for each URL (using exponential moving average of observed change events), computes the target re-crawl interval as `1/r_i`, and schedules the next re-crawl at `last_crawl_time + 1/r_i`. HTTP conditional requests (If-Modified-Since, ETag) reduce the bandwidth cost of re-crawling unchanged pages. Pages with no observed changes after several visits have their estimated change rate decay toward zero, freeing budget for more dynamic pages.

**Q8: How would you architect a web crawler that can scale from 1 billion to 100 billion pages per month without a fundamental redesign?**

The architecture must be horizontally scalable at every layer. The URL frontier is distributed using consistent hashing with virtual nodes — to scale from 30 to 3,000 crawler nodes, we simply add nodes and rebalance the hash ring. The bloom filter is partitioned (each node's bloom filter covers only the URL partition it owns), so adding nodes reduces per-node bloom filter size. Content storage uses a distributed object store like S3, which scales seamlessly with no configuration changes. The DNS cache scales by running a local cache per node (no shared state) and optionally adding dedicated DNS resolver nodes if the aggregate cache miss rate becomes problematic. Cross-node URL routing (when a node discovers a URL that maps to a different node) scales via a message broker like Kafka — each node produces discovered URLs to a Kafka topic partitioned by hostname hash, and each node consumes from its own partition. Kafka topics can scale to thousands of partitions. The headless rendering cluster scales independently by adding browser instances, fronted by a load balancer. Critical to the 100x scaling story is that the politeness constraint (1 request per second per host) does not scale with the number of crawler nodes — it is a property of the target host. So 100x more pages means crawling 100x more hosts, not crawling the same hosts 100x faster. The consistent hashing ensures each host is still managed by a single node, preserving local rate limiting. Monitoring and alerting must also scale: per-node metrics are aggregated (e.g., Prometheus with federation) rather than centralized.

**Q9: How would you design a content deduplication system that detects near-duplicate pages across the entire crawl corpus?**

Exact duplicate detection is straightforward (hash the content, compare hashes), but near-duplicate detection requires fuzzy matching. The standard approach is SimHash (Charikar, 2002), which computes a fixed-size fingerprint of a document such that similar documents produce fingerprints with small Hamming distance. The algorithm works as follows: tokenize the document into shingles (e.g., word trigrams), hash each shingle to a 64-bit value, compute a weighted sum across all bits (adding +1 for each 1-bit and -1 for each 0-bit across all shingle hashes), and produce a final 64-bit fingerprint by setting each bit position to 1 if the weighted sum is positive, 0 otherwise. Two documents are near-duplicates if their SimHash fingerprints differ in fewer than k bit positions (typically k=3 for 64-bit hashes). To efficiently find all near-duplicate pairs in a corpus of billions of documents, the fingerprints are stored in multiple index tables that bucket fingerprints by subsets of their bits (the "bit sampling" approach): if you partition the 64 bits into 4 blocks of 16 bits and create a table for each block, two fingerprints that differ in at most 3 bits must match exactly in at least one of the 4 blocks, allowing lookup by block value. This reduces the comparison space from O(n^2) to O(n) expected time. In practice, SimHash is computed during the content processing phase and stored alongside the page content. Before storing a new page, the system checks the SimHash index for near-duplicates; if found, the page is flagged as duplicate and either skipped or stored with a duplicate marker.

---

### Section 11 — Complete Code Example

Below is a comprehensive implementation of a web crawler in both pseudocode and Node.js. The implementation covers the URL frontier with politeness, robots.txt compliance, content extraction, link discovery, bloom filter deduplication, and the core crawl loop.

#### Pseudocode

```
ALGORITHM WebCrawler

DATA STRUCTURES:
    BloomFilter:
        bitArray: array of m bits, all initialized to 0
        hashFunctions: array of k hash functions

    URLFrontier:
        frontQueues: array of F priority queues
        backQueues: map from hostname to queue
        hostLastFetch: map from hostname to timestamp
        hostCrawlDelay: map from hostname to delay (seconds)

    RobotsCache:
        rules: map from hostname to parsed robots.txt rules
        lastFetched: map from hostname to timestamp

FUNCTION initBloomFilter(expectedItems, falsePositiveRate):
    m = ceil(-(expectedItems * ln(falsePositiveRate)) / (ln(2))^2)
    k = round((m / expectedItems) * ln(2))
    RETURN BloomFilter with m-bit array and k hash functions

FUNCTION bloomFilterAdd(filter, url):
    FOR each hashFunction h in filter.hashFunctions:
        index = h(url) MOD filter.m
        filter.bitArray[index] = 1

FUNCTION bloomFilterContains(filter, url):
    FOR each hashFunction h in filter.hashFunctions:
        index = h(url) MOD filter.m
        IF filter.bitArray[index] == 0:
            RETURN false
    RETURN true  // possibly a false positive

FUNCTION normalizeURL(rawURL):
    parsed = parseURL(rawURL)
    parsed.hostname = lowercase(parsed.hostname)
    parsed.scheme = lowercase(parsed.scheme)
    REMOVE fragment from parsed
    REMOVE default port (80 for http, 443 for https)
    REMOVE trailing slash from path (unless path is "/")
    SORT query parameters alphabetically
    REMOVE tracking parameters (utm_source, utm_medium, etc.)
    RETURN reconstructURL(parsed)

FUNCTION fetchRobotsTxt(hostname, robotsCache):
    IF hostname IN robotsCache AND age < 24 hours:
        RETURN robotsCache[hostname]
    response = HTTP_GET("https://" + hostname + "/robots.txt")
    IF response.status == 200:
        rules = parseRobotsTxt(response.body)
    ELSE:
        rules = ALLOW_ALL  // no robots.txt means everything is allowed
    robotsCache[hostname] = rules
    RETURN rules

FUNCTION isAllowed(url, robotsCache, userAgent):
    hostname = extractHostname(url)
    rules = fetchRobotsTxt(hostname, robotsCache)
    RETURN rules.isAllowed(userAgent, extractPath(url))

FUNCTION addToFrontier(frontier, url, priority):
    hostname = extractHostname(url)
    queueIndex = mapPriorityToQueue(priority)
    frontier.frontQueues[queueIndex].enqueue(url)

FUNCTION getNextURL(frontier):
    // Select from front queues with priority bias
    url = selectFromFrontQueues(frontier.frontQueues)
    hostname = extractHostname(url)

    // Ensure per-host rate limit
    IF hostname IN frontier.hostLastFetch:
        delay = frontier.hostCrawlDelay.get(hostname, 1.0)
        elapsed = now() - frontier.hostLastFetch[hostname]
        IF elapsed < delay:
            WAIT(delay - elapsed)

    frontier.hostLastFetch[hostname] = now()
    RETURN url

FUNCTION crawlPage(url, robotsCache, bloomFilter, frontier, storage):
    // Check robots.txt
    IF NOT isAllowed(url, robotsCache, "MyCrawler"):
        RETURN

    // Fetch the page
    response = HTTP_GET(url, timeout=30s, maxSize=10MB)
    IF response.status NOT IN [200, 301, 302]:
        RETURN

    // Handle redirects
    IF response.status IN [301, 302]:
        redirectURL = normalizeURL(response.headers["Location"])
        IF NOT bloomFilterContains(bloomFilter, redirectURL):
            bloomFilterAdd(bloomFilter, redirectURL)
            addToFrontier(frontier, redirectURL, PRIORITY_MEDIUM)
        RETURN

    // Parse content
    html = response.body
    title = extractTitle(html)
    bodyText = extractBodyText(html)
    links = extractLinks(html, baseURL=url)

    // Store content
    storage.store(url, {
        html: html,
        title: title,
        bodyText: bodyText,
        crawledAt: now(),
        statusCode: response.status
    })

    // Process discovered links
    FOR each link in links:
        normalizedLink = normalizeURL(link)
        IF NOT bloomFilterContains(bloomFilter, normalizedLink):
            bloomFilterAdd(bloomFilter, normalizedLink)
            priority = computePriority(normalizedLink)
            addToFrontier(frontier, normalizedLink, priority)

MAIN FUNCTION run(seedURLs):
    bloomFilter = initBloomFilter(5_000_000_000, 0.01)
    frontier = new URLFrontier()
    robotsCache = new RobotsCache()
    storage = new ContentStorage()

    // Initialize with seed URLs
    FOR each url in seedURLs:
        normalized = normalizeURL(url)
        bloomFilterAdd(bloomFilter, normalized)
        addToFrontier(frontier, normalized, PRIORITY_HIGH)

    // Main crawl loop (runs across multiple worker threads)
    PARALLEL FOR numWorkers:
        LOOP forever:
            url = getNextURL(frontier)
            TRY:
                crawlPage(url, robotsCache, bloomFilter,
                          frontier, storage)
            CATCH exception:
                log("Error crawling " + url + ": " + exception)
                // Optionally re-enqueue with lower priority
```

#### Node.js Implementation

```javascript
// web-crawler.js
// A complete web crawler implementation demonstrating URL frontier,
// politeness, robots.txt compliance, bloom filter deduplication,
// content extraction, and link discovery.

const http = require('http');                    // HTTP client for making requests
const https = require('https');                  // HTTPS client for secure requests
const { URL } = require('url');                  // URL parsing and manipulation
const crypto = require('crypto');                // Hashing for bloom filter
const { EventEmitter } = require('events');      // Event-driven coordination

// ─────────────────────────────────────────────
// BLOOM FILTER IMPLEMENTATION
// ─────────────────────────────────────────────

class BloomFilter {
    /**
     * Initialize a bloom filter with calculated optimal parameters.
     * @param {number} expectedItems - Expected number of unique URLs
     * @param {number} falsePositiveRate - Acceptable false positive rate (e.g., 0.01)
     */
    constructor(expectedItems, falsePositiveRate) {
        // Calculate optimal bit array size: m = -(n * ln(p)) / (ln(2))^2
        // This formula minimizes the false positive rate for a given number of items.
        this.size = Math.ceil(
            -(expectedItems * Math.log(falsePositiveRate)) / (Math.log(2) ** 2)
        );

        // Calculate optimal number of hash functions: k = (m/n) * ln(2)
        // Too few hash functions increase false positives; too many fill the
        // bit array too quickly. This formula finds the sweet spot.
        this.hashCount = Math.round((this.size / expectedItems) * Math.log(2));

        // Use a Buffer as the bit array. Each byte holds 8 bits,
        // so we need size/8 bytes. Buffer.alloc initializes all bits to 0.
        this.bitArray = Buffer.alloc(Math.ceil(this.size / 8));

        this.itemCount = 0; // Track how many items have been added
    }

    /**
     * Generate k hash values for a given string using double hashing.
     * Double hashing uses two independent hash functions (h1, h2) to
     * simulate k hash functions: h_i(x) = h1(x) + i * h2(x).
     * This avoids computing k separate cryptographic hashes.
     */
    _getHashValues(value) {
        // First hash: MD5 of the value, take first 8 bytes as a number
        const h1 = parseInt(
            crypto.createHash('md5').update(value).digest('hex').slice(0, 8),
            16
        );
        // Second hash: SHA1 of the value, take first 8 bytes as a number
        const h2 = parseInt(
            crypto.createHash('sha1').update(value).digest('hex').slice(0, 8),
            16
        );

        const positions = [];
        for (let i = 0; i < this.hashCount; i++) {
            // Combine h1 and h2 to produce the i-th hash position.
            // The modulo ensures the position falls within the bit array.
            positions.push(Math.abs((h1 + i * h2) % this.size));
        }
        return positions;
    }

    /**
     * Add a URL to the bloom filter by setting all k bit positions.
     */
    add(url) {
        const positions = this._getHashValues(url);
        for (const pos of positions) {
            const byteIndex = Math.floor(pos / 8); // Which byte contains this bit
            const bitIndex = pos % 8;               // Which bit within that byte
            this.bitArray[byteIndex] |= (1 << bitIndex); // Set the bit to 1
        }
        this.itemCount++;
    }

    /**
     * Check if a URL might be in the set. Returns true if all k bit
     * positions are set (possible member or false positive), false if
     * any bit is not set (definitely not a member).
     */
    contains(url) {
        const positions = this._getHashValues(url);
        for (const pos of positions) {
            const byteIndex = Math.floor(pos / 8);
            const bitIndex = pos % 8;
            // If any bit is 0, the URL was definitely never added
            if ((this.bitArray[byteIndex] & (1 << bitIndex)) === 0) {
                return false;
            }
        }
        return true; // All bits set — probably seen (or false positive)
    }
}

// ─────────────────────────────────────────────
// URL NORMALIZER
// ─────────────────────────────────────────────

// Tracking parameters that do not affect page content.
// Removing them prevents the same page from being crawled
// multiple times under different tracking URLs.
const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
    'utm_content', 'fbclid', 'gclid', 'ref', 'source'
]);

/**
 * Normalize a URL to a canonical form so that equivalent URLs
 * map to the same string and are correctly deduplicated.
 */
function normalizeURL(rawURL, baseURL) {
    try {
        // Resolve relative URLs against the base URL of the page
        // where they were found. e.g., "./about" on https://example.com/
        // becomes https://example.com/about
        const url = new URL(rawURL, baseURL);

        // Only crawl HTTP and HTTPS URLs — skip mailto:, ftp:, javascript:, etc.
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }

        // Lowercase the hostname (DNS is case-insensitive)
        url.hostname = url.hostname.toLowerCase();

        // Remove fragment — fragments are client-side only and never
        // sent to the server, so they don't identify different pages
        url.hash = '';

        // Remove default ports (80 for HTTP, 443 for HTTPS)
        if ((url.protocol === 'http:' && url.port === '80') ||
            (url.protocol === 'https:' && url.port === '443')) {
            url.port = '';
        }

        // Remove trailing slash from path (unless it's the root "/")
        if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
            url.pathname = url.pathname.slice(0, -1);
        }

        // Sort query parameters alphabetically and remove tracking params.
        // This ensures that ?a=1&b=2 and ?b=2&a=1 produce the same URL.
        const params = new URLSearchParams(url.searchParams);
        const sortedParams = new URLSearchParams();
        const keys = Array.from(params.keys()).sort();
        for (const key of keys) {
            if (!TRACKING_PARAMS.has(key.toLowerCase())) {
                sortedParams.set(key, params.get(key));
            }
        }
        url.search = sortedParams.toString() ? '?' + sortedParams.toString() : '';

        return url.toString();
    } catch (e) {
        // If the URL is malformed, discard it
        return null;
    }
}

// ─────────────────────────────────────────────
// ROBOTS.TXT PARSER AND CACHE
// ─────────────────────────────────────────────

class RobotsParser {
    /**
     * Parse a robots.txt file body into structured rules.
     * The parser extracts Disallow, Allow, and Crawl-delay directives
     * for each User-agent block, plus any Sitemap references.
     */
    constructor(robotsTxtBody) {
        this.rules = [];      // Array of {path, allowed} objects
        this.crawlDelay = 1;  // Default: 1 second between requests
        this.sitemaps = [];   // Sitemap URLs found in robots.txt

        if (!robotsTxtBody) return;

        let isRelevantBlock = false; // Are we inside a block that applies to us?
        const lines = robotsTxtBody.split('\n');

        for (const rawLine of lines) {
            // Strip comments (everything after #) and whitespace
            const line = rawLine.split('#')[0].trim().toLowerCase();
            if (!line) continue;

            if (line.startsWith('user-agent:')) {
                const agent = line.split(':')[1].trim();
                // Apply rules from blocks targeting all crawlers (*)
                // or our specific crawler name
                isRelevantBlock = (agent === '*' || agent === 'mycrawler');
            } else if (isRelevantBlock && line.startsWith('disallow:')) {
                const path = line.split(':').slice(1).join(':').trim();
                if (path) {
                    this.rules.push({ path, allowed: false });
                }
            } else if (isRelevantBlock && line.startsWith('allow:')) {
                const path = line.split(':').slice(1).join(':').trim();
                if (path) {
                    this.rules.push({ path, allowed: true });
                }
            } else if (isRelevantBlock && line.startsWith('crawl-delay:')) {
                const delay = parseFloat(line.split(':')[1].trim());
                if (!isNaN(delay) && delay > 0) {
                    this.crawlDelay = delay;
                }
            } else if (line.startsWith('sitemap:')) {
                // Sitemap directives are global, not per User-agent
                const sitemapURL = rawLine.split(':').slice(1).join(':').trim();
                this.sitemaps.push(sitemapURL);
            }
        }
    }

    /**
     * Check if a given URL path is allowed by the parsed rules.
     * Uses longest-match semantics: the most specific matching rule wins.
     */
    isAllowed(urlPath) {
        let bestMatch = null;
        let bestLength = 0;

        for (const rule of this.rules) {
            // Check if the URL path starts with the rule path
            if (urlPath.startsWith(rule.path) && rule.path.length > bestLength) {
                bestMatch = rule;
                bestLength = rule.path.length;
            }
        }

        // If no rule matches, the URL is allowed by default
        return bestMatch ? bestMatch.allowed : true;
    }
}

class RobotsCache {
    constructor() {
        this.cache = new Map();    // hostname -> { parser, fetchedAt }
        this.ttl = 24 * 60 * 60 * 1000; // 24-hour cache TTL
    }

    /**
     * Get the robots.txt parser for a hostname.
     * Fetches and parses robots.txt if not cached or expired.
     */
    async getParser(hostname) {
        const cached = this.cache.get(hostname);
        if (cached && (Date.now() - cached.fetchedAt) < this.ttl) {
            return cached.parser;
        }

        try {
            const body = await httpGet(`https://${hostname}/robots.txt`, 5000);
            const parser = new RobotsParser(body);
            this.cache.set(hostname, { parser, fetchedAt: Date.now() });
            return parser;
        } catch (e) {
            // If robots.txt cannot be fetched (404, timeout, etc.),
            // assume everything is allowed — this is standard behavior.
            const parser = new RobotsParser(null);
            this.cache.set(hostname, { parser, fetchedAt: Date.now() });
            return parser;
        }
    }
}

// ─────────────────────────────────────────────
// URL FRONTIER WITH PRIORITY AND POLITENESS
// ─────────────────────────────────────────────

// Priority levels — higher number means higher priority
const PRIORITY = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2
};

class URLFrontier {
    /**
     * The frontier manages what to crawl next, combining priority
     * ordering (front queues) with per-host rate limiting (back queues).
     */
    constructor() {
        // Front queues: one array per priority level.
        // URLs enter here first, sorted by priority.
        this.frontQueues = {
            [PRIORITY.HIGH]: [],
            [PRIORITY.MEDIUM]: [],
            [PRIORITY.LOW]: []
        };

        // Back queues: one array per hostname.
        // URLs move here after exiting front queues.
        this.backQueues = new Map(); // hostname -> [urls]

        // Per-host rate limiting: track when we last fetched from each host
        this.hostLastFetch = new Map(); // hostname -> timestamp
        this.hostCrawlDelay = new Map(); // hostname -> delay in ms

        this.totalURLs = 0;
    }

    /**
     * Add a URL to the frontier with a given priority level.
     */
    add(url, priority = PRIORITY.MEDIUM) {
        this.frontQueues[priority].push(url);
        this.totalURLs++;
    }

    /**
     * Set the crawl delay for a specific host (from robots.txt).
     */
    setHostCrawlDelay(hostname, delaySeconds) {
        this.hostCrawlDelay.set(hostname, delaySeconds * 1000);
    }

    /**
     * Get the next URL that is ready to be crawled, respecting
     * per-host rate limits. Returns null if no URL is ready.
     */
    getNext() {
        // Try each priority level from highest to lowest.
        // This implements the priority bias: HIGH is checked first.
        const priorities = [PRIORITY.HIGH, PRIORITY.MEDIUM, PRIORITY.LOW];

        for (const priority of priorities) {
            const queue = this.frontQueues[priority];
            // Scan the queue for a URL whose host is not rate-limited
            for (let i = 0; i < queue.length; i++) {
                const url = queue[i];
                const hostname = new URL(url).hostname;
                const delay = this.hostCrawlDelay.get(hostname) || 1000;
                const lastFetch = this.hostLastFetch.get(hostname) || 0;

                // Check if enough time has passed since the last request
                // to this host
                if (Date.now() - lastFetch >= delay) {
                    // Remove URL from queue and update last-fetch timestamp
                    queue.splice(i, 1);
                    this.hostLastFetch.set(hostname, Date.now());
                    this.totalURLs--;
                    return url;
                }
            }
        }

        return null; // No URL is ready right now
    }

    /**
     * Check if the frontier has any URLs remaining.
     */
    isEmpty() {
        return this.totalURLs === 0;
    }
}

// ─────────────────────────────────────────────
// HTTP UTILITY
// ─────────────────────────────────────────────

/**
 * Perform an HTTP/HTTPS GET request with timeout and size limit.
 * Returns the response body as a string.
 * Follows redirects up to a configurable limit.
 */
function httpGet(url, timeout = 30000, maxSize = 10 * 1024 * 1024, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects < 0) {
            return reject(new Error('Too many redirects'));
        }

        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout }, (res) => {
            // Handle redirects (301, 302, 307, 308)
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                const redirectURL = new URL(res.headers.location, url).toString();
                return httpGet(redirectURL, timeout, maxSize, maxRedirects - 1)
                    .then(resolve)
                    .catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            let data = '';
            let size = 0;
            res.setEncoding('utf8');

            res.on('data', (chunk) => {
                size += chunk.length;
                // Enforce maximum response size to prevent memory exhaustion
                if (size > maxSize) {
                    req.destroy();
                    reject(new Error('Response too large'));
                }
                data += chunk;
            });

            res.on('end', () => resolve(data));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.on('error', reject);
    });
}

// ─────────────────────────────────────────────
// CONTENT PARSER AND LINK EXTRACTOR
// ─────────────────────────────────────────────

/**
 * Extract the page title from raw HTML.
 * Uses a simple regex to find the <title> tag content.
 */
function extractTitle(html) {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].trim() : '';
}

/**
 * Extract visible body text from raw HTML.
 * Strips all tags, script/style content, and normalizes whitespace.
 * Production systems use more sophisticated boilerplate removal.
 */
function extractBodyText(html) {
    let text = html;
    // Remove script and style blocks entirely — they contain no
    // visible content and would pollute the extracted text
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/&nbsp;/g, ' ');
    // Normalize whitespace: collapse multiple spaces/newlines into one space
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

/**
 * Extract all hyperlinks from an HTML page.
 * Finds all href attributes in <a> tags, resolves them to
 * absolute URLs using the page's base URL, and normalizes them.
 */
function extractLinks(html, baseURL) {
    const links = [];
    // Regex to find href attributes in anchor tags.
    // This is simplified; production systems use a proper HTML parser.
    const hrefRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let match;

    while ((match = hrefRegex.exec(html)) !== null) {
        const rawHref = match[1];
        const normalized = normalizeURL(rawHref, baseURL);
        if (normalized) {
            links.push(normalized);
        }
    }

    return links;
}

// ─────────────────────────────────────────────
// CRAWLER TRAP DETECTION
// ─────────────────────────────────────────────

/**
 * Check if a URL looks like it might be part of a crawler trap.
 * Returns true if the URL should be skipped.
 */
function isTrap(url) {
    try {
        const parsed = new URL(url);
        const pathSegments = parsed.pathname.split('/').filter(Boolean);

        // Trap: excessive path depth (> 15 segments)
        if (pathSegments.length > 15) {
            return true;
        }

        // Trap: repeating path segments (e.g., /a/b/a/b/a/b)
        // Detects infinite depth loops
        const pathStr = parsed.pathname;
        for (let len = 1; len <= Math.floor(pathSegments.length / 3); len++) {
            const segment = pathSegments.slice(0, len).join('/');
            const repeated = pathStr.split(segment).length - 1;
            if (repeated >= 3) {
                return true;
            }
        }

        // Trap: session-like IDs in URL (long hex or base64 strings)
        if (/[?&](sid|session|jsessionid|phpsessid)=/i.test(parsed.search)) {
            return true;
        }

        return false;
    } catch (e) {
        return true; // Malformed URLs are treated as traps
    }
}

// ─────────────────────────────────────────────
// SIMPLE PRIORITY SCORER
// ─────────────────────────────────────────────

/**
 * Compute a priority score for a discovered URL.
 * Production systems use PageRank, domain authority, and
 * historical change rate. This simplified version uses URL depth
 * and domain characteristics as heuristics.
 */
function computePriority(url) {
    try {
        const parsed = new URL(url);
        const depth = parsed.pathname.split('/').filter(Boolean).length;

        // Root pages and shallow pages get high priority
        if (depth <= 1) return PRIORITY.HIGH;

        // Medium-depth pages get medium priority
        if (depth <= 3) return PRIORITY.MEDIUM;

        // Deep pages get low priority
        return PRIORITY.LOW;
    } catch (e) {
        return PRIORITY.LOW;
    }
}

// ─────────────────────────────────────────────
// MAIN CRAWLER ORCHESTRATOR
// ─────────────────────────────────────────────

class WebCrawler extends EventEmitter {
    /**
     * @param {Object} options - Crawler configuration
     * @param {string[]} options.seedURLs - Starting URLs for the crawl
     * @param {number} options.maxPages - Maximum pages to crawl
     * @param {number} options.concurrency - Number of parallel fetcher workers
     * @param {number} options.bloomFilterSize - Expected number of unique URLs
     */
    constructor(options = {}) {
        super();
        this.seedURLs = options.seedURLs || [];
        this.maxPages = options.maxPages || 1000;
        this.concurrency = options.concurrency || 5;

        // Initialize core components
        this.bloomFilter = new BloomFilter(
            options.bloomFilterSize || 1000000,
            0.01  // 1% false positive rate
        );
        this.frontier = new URLFrontier();
        this.robotsCache = new RobotsCache();

        // Crawl state tracking
        this.pagesCrawled = 0;
        this.storage = []; // In-memory storage (replace with DB in production)
        this.activeWorkers = 0;
        this.running = false;
    }

    /**
     * Initialize the frontier with seed URLs.
     * Each seed URL is added to the bloom filter and the frontier
     * with HIGH priority to ensure they are crawled first.
     */
    _initSeeds() {
        for (const rawURL of this.seedURLs) {
            const normalized = normalizeURL(rawURL, rawURL);
            if (normalized && !this.bloomFilter.contains(normalized)) {
                this.bloomFilter.add(normalized);
                this.frontier.add(normalized, PRIORITY.HIGH);
            }
        }
    }

    /**
     * The main crawl method. Seeds the frontier, then launches
     * concurrent worker loops that pull URLs from the frontier
     * and process them.
     */
    async crawl() {
        this.running = true;
        this._initSeeds();
        this.emit('start', { seedCount: this.seedURLs.length });

        // Launch concurrent worker tasks
        const workers = [];
        for (let i = 0; i < this.concurrency; i++) {
            workers.push(this._workerLoop(i));
        }

        // Wait for all workers to finish
        await Promise.all(workers);

        this.running = false;
        this.emit('complete', {
            pagesCrawled: this.pagesCrawled,
            urlsSeen: this.bloomFilter.itemCount
        });

        return this.storage;
    }

    /**
     * A single worker loop. Continuously pulls URLs from the frontier
     * and processes them until the crawl limit is reached or the
     * frontier is exhausted.
     */
    async _workerLoop(workerId) {
        while (this.running && this.pagesCrawled < this.maxPages) {
            const url = this.frontier.getNext();

            if (!url) {
                // No URL is ready — wait briefly and try again.
                // This happens when all remaining URLs are rate-limited.
                if (this.frontier.isEmpty()) break;
                await sleep(100);
                continue;
            }

            this.activeWorkers++;
            try {
                await this._processURL(url, workerId);
            } catch (error) {
                this.emit('error', { url, error: error.message, workerId });
            }
            this.activeWorkers--;
        }
    }

    /**
     * Process a single URL: check robots.txt, fetch the page,
     * extract content and links, store results, and add new
     * URLs to the frontier.
     */
    async _processURL(url, workerId) {
        const hostname = new URL(url).hostname;

        // Step 1: Check robots.txt compliance
        const robotsParser = await this.robotsCache.getParser(hostname);
        const urlPath = new URL(url).pathname;

        if (!robotsParser.isAllowed(urlPath)) {
            this.emit('blocked', { url, reason: 'robots.txt' });
            return;
        }

        // Apply the host's crawl delay to the frontier
        this.frontier.setHostCrawlDelay(hostname, robotsParser.crawlDelay);

        // Step 2: Fetch the page
        this.emit('fetching', { url, workerId });
        let html;
        try {
            html = await httpGet(url, 30000);
        } catch (error) {
            this.emit('fetchError', { url, error: error.message });
            return;
        }

        this.pagesCrawled++;

        // Step 3: Extract content
        const title = extractTitle(html);
        const bodyText = extractBodyText(html);
        const links = extractLinks(html, url);

        // Step 4: Store the crawled page
        const pageData = {
            url,
            title,
            bodyTextLength: bodyText.length,
            linksFound: links.length,
            crawledAt: new Date().toISOString(),
            contentSnippet: bodyText.substring(0, 200)
        };
        this.storage.push(pageData);

        this.emit('crawled', {
            url,
            title,
            linksFound: links.length,
            pageNumber: this.pagesCrawled,
            workerId
        });

        // Step 5: Process discovered links
        let newURLs = 0;
        for (const link of links) {
            // Skip trap URLs
            if (isTrap(link)) continue;

            // Skip URLs already seen (bloom filter check)
            if (this.bloomFilter.contains(link)) continue;

            // Mark as seen and add to frontier
            this.bloomFilter.add(link);
            const priority = computePriority(link);
            this.frontier.add(link, priority);
            newURLs++;
        }

        this.emit('linksProcessed', {
            url,
            totalLinks: links.length,
            newLinks: newURLs
        });
    }
}

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// USAGE EXAMPLE
// ─────────────────────────────────────────────

async function main() {
    const crawler = new WebCrawler({
        seedURLs: [
            'https://example.com',
            'https://www.iana.org'
        ],
        maxPages: 50,        // Limit for demonstration
        concurrency: 3,      // 3 parallel workers
        bloomFilterSize: 100000
    });

    // Register event listeners for monitoring
    crawler.on('start', (info) => {
        console.log(`Crawl started with ${info.seedCount} seed URLs`);
    });

    crawler.on('crawled', (info) => {
        console.log(
            `[Worker ${info.workerId}] Page ${info.pageNumber}: ` +
            `${info.title || '(no title)'} — ${info.url} ` +
            `(${info.linksFound} links found)`
        );
    });

    crawler.on('blocked', (info) => {
        console.log(`BLOCKED by ${info.reason}: ${info.url}`);
    });

    crawler.on('error', (info) => {
        console.error(`ERROR [Worker ${info.workerId}]: ${info.url} — ${info.error}`);
    });

    crawler.on('complete', (info) => {
        console.log(
            `\nCrawl complete: ${info.pagesCrawled} pages crawled, ` +
            `${info.urlsSeen} unique URLs seen`
        );
    });

    // Start the crawl
    const results = await crawler.crawl();

    // Display summary
    console.log('\n--- Crawl Results ---');
    for (const page of results) {
        console.log(`  ${page.url}`);
        console.log(`    Title: ${page.title || '(none)'}`);
        console.log(`    Content length: ${page.bodyTextLength} chars`);
        console.log(`    Links found: ${page.linksFound}`);
        console.log(`    Crawled at: ${page.crawledAt}`);
    }
}

// Run the crawler
main().catch(console.error);
```

**Line-by-line explanation of key design decisions**:

The `BloomFilter` class computes optimal parameters (`m` bits, `k` hash functions) from the expected number of items and desired false positive rate. The double-hashing technique in `_getHashValues` avoids computing multiple expensive cryptographic hashes — instead, two hashes (MD5 and SHA1) are combined linearly to produce `k` hash values, which is mathematically equivalent to `k` independent hash functions for bloom filter purposes.

The `normalizeURL` function handles the many ways the same page can be represented as different URLs. It lowercases the hostname, removes fragments, strips default ports, removes trailing slashes, sorts query parameters, and removes tracking parameters. This normalization is essential for the bloom filter to work correctly — without it, `http://Example.com/Page?b=2&a=1` and `http://example.com/page?a=1&b=2` would be treated as different URLs.

The `URLFrontier` class implements a simplified version of the Mercator architecture. Front queues are organized by priority level (HIGH, MEDIUM, LOW), and the `getNext` method scans from highest to lowest priority, checking per-host rate limits before returning a URL. In a production system, the back queues would be explicit data structures mapped by hostname; here, the rate limiting is done inline for clarity.

The `WebCrawler` class orchestrates the entire process. The `crawl` method launches multiple concurrent `_workerLoop` tasks (simulating fetcher workers). Each worker pulls URLs from the frontier, checks robots.txt compliance, fetches the page, extracts content and links, stores the results, and feeds new URLs back into the frontier. The event emitter pattern enables monitoring and logging without coupling the core crawl logic to any specific output format.

The `isTrap` function implements basic crawler trap detection: it rejects URLs with excessive path depth, repeating path segments, and session-like parameters. Production systems would add more sophisticated detection, including content fingerprinting and per-domain URL budgets.

---

### Section 12 — Connection to Next Topic

In this topic, we designed a system that systematically discovers, downloads, and processes the world's web content — a write-heavy, crawl-intensive pipeline that must scale to billions of pages while respecting the constraints of the servers it visits. The web crawler is fundamentally about *ingesting* content from the open internet and making it available for downstream systems.

In Topic 50, we shift from ingesting text-based web content to *delivering* rich media content — specifically, designing a Video Streaming Platform. Where the web crawler reads billions of small documents from millions of servers, a video streaming platform writes relatively few large media assets but reads them billions of times, delivering them to millions of concurrent viewers. The challenges flip: instead of politeness constraints and URL deduplication, we face adaptive bitrate streaming, content delivery networks (CDNs), video transcoding pipelines, and real-time viewer experience optimization.

The architectural patterns, however, share deep connections. Both systems require distributed storage at petabyte scale. Both rely on priority queues (the crawler's URL frontier; the streaming platform's transcoding job queue). Both must handle geographic distribution (the crawler fetches from servers worldwide; the streaming platform delivers to viewers worldwide via CDNs). And both must be resilient to partial failures — a crashed crawler node must not lose its URL frontier state, just as a failed CDN edge node must not interrupt playback for viewers.

The transition from "fetching the web's content" to "streaming the web's richest content" is a natural progression in the curriculum. Having mastered the distributed coordination, deduplication, and scaling challenges of a web crawler, you are well-prepared to tackle the encoding pipelines, delivery networks, and real-time optimization that define video streaming at scale.

---

*Next up: **Topic 50 — Design a Video Streaming Platform**, where we design a system that encodes, stores, and delivers video content to millions of concurrent viewers with adaptive quality and minimal buffering.*
