import {
  SiNodedotjs, SiExpress, SiReact, SiMongodb, SiRedis,
  SiDocker, SiJavascript, SiJsonwebtokens,
  SiSocketdotio, SiGit, SiGithubactions, SiMui,
  SiDotnet,
} from 'react-icons/si';
import {
  FaServer, FaShieldAlt, FaProjectDiagram, FaCogs,
  FaDatabase, FaCloud, FaCode, FaDesktop, FaMicrochip, FaAws,
  FaChartLine, FaBolt, FaUsers, FaLock, FaCheckCircle,
  FaShoppingCart, FaRocket, FaClock,
} from 'react-icons/fa';

export const personalInfo = {
  name: 'Sonu Prajapati',
  title: 'Backend Engineer | Banking Systems Specialist',
  tagline: 'Building Secure, Scalable Financial Systems',
  description: 'Backend engineer with experience building secure APIs, financial transaction systems, and scalable backend architectures.',
  email: 'prajapatisonu50@gmail.com',
  linkedin: 'https://linkedin.com/in/sonuprajapati',
  github: 'https://github.com/sonu-rathinfotech',
  location: 'India',
};

export const heroTechStack = [
  { name: 'Node.js', icon: SiNodedotjs, color: '#339933' },
  { name: 'React', icon: SiReact, color: '#61DAFB' },
  { name: 'MongoDB', icon: SiMongodb, color: '#47A248' },
  { name: 'AWS', icon: FaAws, color: '#FF9900' },
  { name: 'Redis', icon: SiRedis, color: '#DC382D' },
];

export const aboutData = {
  summary: `I'm a Backend Engineer with 4 years of experience building production-grade systems across banking and e-commerce domains. For the past 2 years, I've been working on mission-critical banking infrastructure — developing secure APIs, managing financial data flows, and ensuring system reliability under strict compliance standards.`,
  highlights: [
    { label: 'Years Experience', value: '4+' },
    { label: 'Banking Domain', value: '2 Years' },
    { label: 'E-commerce', value: '2 Years' },
    { label: 'Systems Built', value: '15+' },
  ],
  description2: `Before banking, I spent 2 years building scalable e-commerce backends — designing REST APIs, implementing real-time features, and optimizing high-traffic applications. I'm passionate about clean architecture, system design, and building software that scales.`,
};

export const experiences = [
  {
    id: 1,
    type: 'banking',
    company: 'Leading Banking Solutions Provider',
    role: 'Backend Engineer — Banking Systems',
    duration: 'Jan 2023 – Present',
    location: 'India',
    description: [
      'Developed secure backend services for production banking applications serving thousands of customers',
      'Worked on multi-layer .NET banking architecture integrating with Core Banking Systems (CBS)',
      'Built and maintained APIs for financial transaction processing and account management',
      'Implemented robust authentication and authorization systems following banking security standards',
      'Managed financial data flows ensuring data integrity across distributed systems',
      'Handled critical production incidents and performed root cause analysis on banking systems',
      'Followed strict security, compliance, and audit standards (PCI-DSS awareness)',
    ],
    technologies: ['.NET', 'REST APIs', 'SQL Server', 'Core Banking', 'Authentication', 'Security'],
    challengesSolved: [
      'Debugged API latency issues impacting transaction processing times',
      'Implemented retry mechanisms for failing inter-service communications',
      'Optimized database queries reducing report generation time by 40%',
    ],
    highlights: [
      { icon: FaChartLine, value: '40%', label: 'Query Optimization', color: '#00C9A7' },
      { icon: FaLock, value: 'PCI-DSS', label: 'Compliance Ready', color: '#F5A623' },
      { icon: FaUsers, value: '1000s', label: 'Customers Served', color: '#3B82F6' },
      { icon: FaBolt, value: '99.9%', label: 'System Uptime', color: '#10B981' },
    ],
    techIcons: [
      { icon: SiDotnet, name: '.NET', color: '#512BD4' },
      { icon: FaDatabase, name: 'SQL Server', color: '#CC2927' },
      { icon: FaShieldAlt, name: 'Security', color: '#F5A623' },
      { icon: FaServer, name: 'REST APIs', color: '#00C9A7' },
    ],
  },
  {
    id: 2,
    type: 'ecommerce',
    company: 'E-Commerce Technology Company',
    role: 'Software Engineer — Backend',
    duration: 'Jan 2021 – Dec 2022',
    location: 'India',
    description: [
      'Built scalable Node.js backend services handling high-traffic workloads',
      'Designed and implemented RESTful APIs serving 50+ endpoints for web and mobile clients',
      'Implemented JWT-based authentication and session management',
      'Built real-time communication features using WebSockets',
      'Optimized backend performance and database queries for faster response times',
    ],
    technologies: ['Node.js', 'Express.js', 'MongoDB', 'Redis', 'WebSockets', 'Docker'],
    challengesSolved: [
      'Fixed pagination performance bottlenecks on large product catalogs',
      'Improved backend reliability with structured logging and monitoring',
    ],
    highlights: [
      { icon: FaRocket, value: '50+', label: 'API Endpoints', color: '#6C63FF' },
      { icon: FaClock, value: '<200ms', label: 'Avg Response Time', color: '#00C9A7' },
      { icon: FaShoppingCart, value: 'High', label: 'Traffic Workloads', color: '#F5A623' },
      { icon: FaCheckCircle, value: 'JWT', label: 'Auth System', color: '#3B82F6' },
    ],
    techIcons: [
      { icon: SiNodedotjs, name: 'Node.js', color: '#339933' },
      { icon: SiMongodb, name: 'MongoDB', color: '#47A248' },
      { icon: SiRedis, name: 'Redis', color: '#DC382D' },
      { icon: SiDocker, name: 'Docker', color: '#2496ED' },
    ],
  },
];

export const skills = {
  backend: {
    title: 'Backend',
    icon: FaServer,
    items: [
      { name: 'Node.js', icon: SiNodedotjs, color: '#339933' },
      { name: 'Express.js', icon: SiExpress, color: '#FFFFFF' },
      { name: 'REST APIs', icon: FaCogs, color: '#00C9A7' },
      { name: 'Microservices', icon: FaMicrochip, color: '#6C63FF' },
      { name: 'Authentication', icon: FaShieldAlt, color: '#F5A623' },
      { name: 'JWT', icon: SiJsonwebtokens, color: '#D63AFF' },
      { name: 'WebSockets', icon: SiSocketdotio, color: '#010101' },
    ],
  },
  frontend: {
    title: 'Frontend',
    icon: FaDesktop,
    items: [
      { name: 'React', icon: SiReact, color: '#61DAFB' },
      { name: 'Material UI', icon: SiMui, color: '#007FFF' },
      { name: 'JavaScript', icon: SiJavascript, color: '#F7DF1E' },
      { name: 'Responsive UI', icon: FaCode, color: '#00C9A7' },
    ],
  },
  databases: {
    title: 'Databases',
    icon: FaDatabase,
    items: [
      { name: 'MongoDB', icon: SiMongodb, color: '#47A248' },
      { name: 'Redis', icon: SiRedis, color: '#DC382D' },
    ],
  },
  infrastructure: {
    title: 'Infrastructure',
    icon: FaCloud,
    items: [
      { name: 'AWS', icon: FaAws, color: '#FF9900' },
      { name: 'Docker', icon: SiDocker, color: '#2496ED' },
      { name: 'CI/CD', icon: SiGithubactions, color: '#2088FF' },
      { name: 'Git', icon: SiGit, color: '#F05032' },
    ],
  },
  architecture: {
    title: 'Architecture',
    icon: FaProjectDiagram,
    items: [
      { name: 'System Design', icon: FaProjectDiagram, color: '#6C63FF' },
      { name: 'Microservices', icon: FaMicrochip, color: '#00C9A7' },
      { name: 'Event Driven', icon: FaCogs, color: '#F5A623' },
      { name: 'API Design', icon: FaCode, color: '#3B82F6' },
    ],
  },
};

export const projects = [
  {
    id: 1,
    title: 'AI Company Finder System',
    description: 'An AI-powered system that intelligently filters and discovers companies based on industry vertical, employee size, funding stage, and technology stack. Features smart search with auto-suggestions.',
    technologies: ['Node.js', 'React', 'MongoDB', 'AI/ML', 'REST APIs'],
    github: 'https://github.com/sonuprajapati/ai-company-finder',
    demo: '#',
    icon: '🤖',
  },
  {
    id: 2,
    title: 'Real-Time Chat System',
    description: 'A scalable WebSocket-based messaging platform supporting real-time communication, typing indicators, read receipts, and message history. Built for high concurrency.',
    technologies: ['Node.js', 'Socket.io', 'Redis', 'MongoDB', 'React'],
    github: 'https://github.com/sonuprajapati/realtime-chat',
    demo: '#',
    icon: '💬',
  },
  {
    id: 3,
    title: 'Blog Platform with Admin Panel',
    description: 'A full-stack blogging platform with role-based access control (Admin, Editor, Viewer), rich text editor, image uploads, and a comprehensive admin dashboard with analytics.',
    technologies: ['React', 'Node.js', 'Express.js', 'MongoDB', 'JWT'],
    github: 'https://github.com/sonuprajapati/blog-platform',
    demo: '#',
    icon: '📝',
  },
  {
    id: 4,
    title: 'Engineering Practice Dashboard',
    description: 'A feature-rich dashboard showcasing advanced frontend patterns — pagination, autocomplete search, infinite scroll, drag-and-drop lists, and dynamic theme switching.',
    technologies: ['React', 'Material UI', 'REST APIs', 'JavaScript'],
    github: 'https://github.com/sonuprajapati/engineering-dashboard',
    demo: '#',
    icon: '⚙️',
  },
];

// To add a new blog:
// 1. Create a .md file in src/data/blogs/ (e.g. my-new-blog.md)
// 2. Add an entry below with `file` matching the filename (without .md)
// That's it — the system auto-imports all .md files from the blogs folder.
export const blogs = [
  {
    file: 'banking-transactions',
    title: 'How Banking Systems Handle Millions of Transactions',
    excerpt: 'A deep dive into the architecture behind high-throughput financial transaction processing, covering ACID compliance, distributed locks, and idempotency patterns.',
    date: 'Feb 2025',
    readTime: '8 min read',
    tags: ['Banking', 'System Design', 'Architecture'],
  },
  {
    file: 'nodejs-vs-dotnet',
    title: 'Node.js vs .NET in Banking Infrastructure',
    excerpt: 'Comparing two backend powerhouses in the context of financial systems — performance, security, ecosystem maturity, and enterprise adoption.',
    date: 'Jan 2025',
    readTime: '6 min read',
    tags: ['Node.js', '.NET', 'Banking'],
  },
  {
    file: 'secure-apis',
    title: 'Building Secure APIs for Financial Systems',
    excerpt: 'Best practices for API security in fintech — from OAuth2 and JWT to rate limiting, input validation, and encryption at rest and in transit.',
    date: 'Dec 2024',
    readTime: '7 min read',
    tags: ['Security', 'APIs', 'Fintech'],
  },
  {
    file: 'scalable-backends',
    title: 'Designing Scalable Backend Architectures',
    excerpt: 'Patterns and principles for building backends that scale — microservices, event-driven architecture, CQRS, and database sharding strategies.',
    date: 'Nov 2024',
    readTime: '9 min read',
    tags: ['Architecture', 'Scalability', 'Backend'],
  },
  {
    file: 'BACKEND_INTERVIEW_QA',
    title: 'Backend Engineering — Deep Dive Q&A',
    excerpt: 'Comprehensive backend interview questions and answers covering Node.js, Express, REST APIs, authentication, file uploads, error handling, and production patterns from real codebases.',
    date: 'Mar 2025',
    readTime: '25 min read',
    tags: ['Backend', 'Node.js', 'Interview'],
  },
  {
    file: 'MONGODB_INTERVIEW_QA',
    title: 'MongoDB — Deep Dive Q&A',
    excerpt: 'In-depth MongoDB interview questions covering schema design, indexing, aggregation pipelines, transactions, replication, sharding, and real-world performance optimization patterns.',
    date: 'Mar 2025',
    readTime: '30 min read',
    tags: ['MongoDB', 'Database', 'Interview'],
  },
  {
    file: 'ADMIN_PANEL_INTERVIEW_QA',
    title: 'Frontend & Admin Panel — Deep Dive Q&A',
    excerpt: 'JavaScript, React, and data structures Q&A covering component architecture, state management, hooks, routing, performance optimization, and admin panel design patterns.',
    date: 'Mar 2025',
    readTime: '20 min read',
    tags: ['React', 'JavaScript', 'Frontend'],
  },
];

export const systemDesignSteps = [
  { label: 'Client (Frontend)', description: 'React / Mobile App', color: '#61DAFB' },
  { label: 'API Gateway', description: 'Load Balancer + Rate Limiting', color: '#00C9A7' },
  { label: 'Authentication Layer', description: 'JWT / OAuth2 + MFA', color: '#F5A623' },
  { label: 'Business Logic Layer', description: 'Microservices + Event Queue', color: '#6C63FF' },
  { label: 'Core Banking System', description: 'Transaction Engine + Ledger', color: '#3B82F6' },
  { label: 'Database + Cache', description: 'MongoDB + Redis', color: '#10B981' },
];

const SD_RAW_BASE = 'https://raw.githubusercontent.com/sonu-rathinfotech/system-design-curriculum/master';

export const systemDesignChapters = [
  {
    id: '01',
    file: '01-fundamentals.md',
    title: 'Fundamentals',
    subtitle: 'Client-Server, Networking, APIs, Proxies, WebSockets',
    topics: 5,
    icon: '🏗️',
    color: '#00C9A7',
  },
  {
    id: '02',
    file: '02-data-and-storage.md',
    title: 'Data & Storage',
    subtitle: 'SQL/NoSQL, Indexing, Sharding, Replication, Caching',
    topics: 9,
    icon: '💾',
    color: '#6C63FF',
  },
  {
    id: '03',
    file: '03-scalability-and-performance.md',
    title: 'Scalability & Performance',
    subtitle: 'Load Balancing, Scaling, CDNs, Rate Limiting',
    topics: 6,
    icon: '📈',
    color: '#F5A623',
  },
  {
    id: '04',
    file: '04-reliability-and-fault-tolerance.md',
    title: 'Reliability & Fault Tolerance',
    subtitle: 'High Availability, Circuit Breakers, Idempotency, DR',
    topics: 4,
    icon: '🛡️',
    color: '#3B82F6',
  },
  {
    id: '05',
    file: '05-communication-and-messaging.md',
    title: 'Communication & Messaging',
    subtitle: 'Queues, Pub/Sub, Kafka, CQRS',
    topics: 4,
    icon: '📡',
    color: '#10B981',
  },
  {
    id: '06',
    file: '06-distributed-systems-core.md',
    title: 'Distributed Systems Core',
    subtitle: 'CAP, Consensus, Locking, Sagas',
    topics: 6,
    icon: '🌐',
    color: '#EC4899',
  },
  {
    id: '07',
    file: '07-security-and-auth.md',
    title: 'Security & Auth',
    subtitle: 'Authentication, Encryption, Threat Modeling',
    topics: 3,
    icon: '🔐',
    color: '#EF4444',
  },
  {
    id: '08',
    file: '08-monitoring-and-observability.md',
    title: 'Monitoring & Observability',
    subtitle: 'Logging, Metrics, Tracing, SLOs',
    topics: 2,
    icon: '📊',
    color: '#8B5CF6',
  },
  {
    id: '09',
    file: '09-real-world-designs-part1.md',
    title: 'Real-World Designs — Part 1',
    subtitle: 'URL Shortener, Rate Limiter, KV Store',
    topics: 5,
    icon: '🔧',
    color: '#F59E0B',
  },
  {
    id: '10',
    file: '10-real-world-designs-part2.md',
    title: 'Real-World Designs — Part 2',
    subtitle: 'Chat System, Notifications, News Feed',
    topics: 5,
    icon: '⚙️',
    color: '#06B6D4',
  },
  {
    id: '11',
    file: '11-real-world-designs-part3.md',
    title: 'Real-World Designs — Part 3',
    subtitle: 'YouTube, Dropbox, Uber, Payments',
    topics: 6,
    icon: '🏭',
    color: '#14B8A6',
  },
  {
    id: '12',
    file: '12-advanced-and-niche.md',
    title: 'Advanced & Niche',
    subtitle: 'Microservices, Kubernetes, Service Mesh',
    topics: 7,
    icon: '🚀',
    color: '#A855F7',
  },
];

export function getChapterUrl(filename) {
  return `${SD_RAW_BASE}/${filename}`;
}

export const navLinks = [
  { label: 'Home', href: '#home' },
  { label: 'About', href: '#about' },
  { label: 'Experience', href: '#experience' },
  { label: 'Skills', href: '#skills' },
  { label: 'Projects', href: '#projects' },
  { label: 'System Design', href: '#system-design' },
  { label: 'Blog', href: '#blog' },
  { label: 'Contact', href: '#contact' },
];
