# Designing Scalable Backend Architectures

Building backends that scale isn't about over-engineering from day one — it's about making the right architectural decisions that allow your system to grow without rewriting everything.

Here are the patterns and principles I follow when designing backend systems.

## Start Simple, Scale Intentionally

The biggest mistake I see is premature optimization. Start with a monolith, identify bottlenecks through monitoring, then extract services strategically.

```
Phase 1: Monolith (0-10K users)
    Single server, single database

Phase 2: Vertical Scaling (10K-100K users)
    Bigger server, read replicas, caching

Phase 3: Horizontal Scaling (100K+ users)
    Microservices, load balancing, sharding
```

## Core Patterns

### 1. Microservices Architecture

Split by business domain, not by technical layer:

```
✅ Good: User Service, Order Service, Payment Service
❌ Bad: Database Service, API Service, Auth Service
```

Each service owns its data and communicates through well-defined APIs or events.

### 2. Event-Driven Architecture

Decouple services using events instead of direct API calls:

```javascript
// Order Service publishes event
eventBus.publish('order.completed', {
  orderId: '12345',
  userId: 'user_789',
  amount: 2500,
  items: [...]
});

// Notification Service subscribes
eventBus.subscribe('order.completed', async (event) => {
  await sendEmail(event.userId, 'Order Confirmed', event);
  await sendSMS(event.userId, `Order #${event.orderId} confirmed`);
});

// Analytics Service subscribes (independently)
eventBus.subscribe('order.completed', async (event) => {
  await trackRevenue(event.amount);
});
```

Benefits:
- Services don't know about each other
- Adding new consumers doesn't require changing the producer
- Events can be replayed for debugging

### 3. CQRS (Command Query Responsibility Segregation)

Separate read and write models when read/write patterns differ significantly:

```
Write Path (Commands):
    API → Validation → Write DB (PostgreSQL)

Read Path (Queries):
    API → Read DB (Elasticsearch / Redis Cache)

Sync:
    Write DB → Change Data Capture → Read DB
```

This is especially useful when:
- Reads outnumber writes 10:1 or more
- Read queries need different data structures (denormalized)
- Search functionality is required

## Database Scaling Strategies

### Read Replicas

```
Write requests → Primary DB
Read requests  → Replica 1, Replica 2, Replica 3 (round-robin)
```

Simple and effective for read-heavy workloads. Most applications are 80% reads.

### Database Sharding

When a single database can't handle the write load:

```
User ID 1-1M     → Shard 1
User ID 1M-2M    → Shard 2
User ID 2M-3M    → Shard 3

// Shard key selection is critical
function getShard(userId) {
  return shards[userId % NUM_SHARDS];
}
```

### Caching Strategy

```javascript
async function getUser(userId) {
  // 1. Check cache first
  const cached = await redis.get(`user:${userId}`);
  if (cached) return JSON.parse(cached);

  // 2. Cache miss — fetch from DB
  const user = await db.users.findById(userId);

  // 3. Store in cache with TTL
  await redis.setex(`user:${userId}`, 3600, JSON.stringify(user));

  return user;
}
```

**Cache invalidation patterns:**
- **TTL-based**: Simple, but data can be stale
- **Write-through**: Update cache on every write
- **Event-driven**: Invalidate cache when data changes

## Load Balancing

```
                    ┌─── Server 1 (Node.js)
Client → Nginx ────┼─── Server 2 (Node.js)
                    └─── Server 3 (Node.js)
```

Strategies:
- **Round-robin**: Simple, works for stateless services
- **Least connections**: Routes to the server with fewest active requests
- **IP hash**: Same client always hits the same server (useful for sessions)

## Monitoring & Observability

You can't scale what you can't measure:

```
The Three Pillars:

1. Metrics (Prometheus/Grafana)
   - Request rate, error rate, latency (p50, p95, p99)
   - CPU, memory, disk usage
   - Database query times

2. Logging (ELK Stack)
   - Structured JSON logs
   - Correlation IDs across services
   - Error aggregation

3. Tracing (Jaeger/Zipkin)
   - Request flow across microservices
   - Bottleneck identification
   - Dependency mapping
```

## Scaling Checklist

| Stage | Action | When |
|-------|--------|------|
| 1 | Add caching (Redis) | Response times > 200ms |
| 2 | Read replicas | DB CPU > 70% |
| 3 | Load balancer + multiple instances | Single server can't handle traffic |
| 4 | Extract hot services to microservices | One module scales differently |
| 5 | Message queues for async work | Background jobs growing |
| 6 | CDN for static assets | Global users |
| 7 | Database sharding | Write throughput maxed |

## Key Takeaway

Scalability is a journey, not a destination. Start simple, measure everything, and scale the bottleneck — not the whole system.

The best architecture is the simplest one that solves today's problems while leaving room for tomorrow's growth.

---

*These patterns come from building backends that grew from hundreds to hundreds of thousands of users.*
