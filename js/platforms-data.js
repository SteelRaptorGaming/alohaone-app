// =============================================================================
// AlohaOne Platforms Catalog
// ---------------------------------------------------------------------------
// Single source of truth for the app's platform list. When a new platform is
// added to the AlohaOne ecosystem, add it here and it shows up in the dashboard,
// the platforms list, and the enable page — no further changes required.
// =============================================================================

const PLATFORMS = [
    {
        slug: 'commerce',
        name: 'AlohaCommerce',
        shortName: 'Commerce',
        icon: 'fa-shopping-cart',
        color: '#0891b2',
        gradient: 'linear-gradient(135deg,#0891b2,#0e7490)',
        status: 'live',
        tagline: 'Multi-tenant e-commerce with themes, storefronts, orders, and payments.',
        capabilities: [
            { id: 'catalog',     name: 'Product Catalog',       description: 'Products, variants, categories, SEO', default: true },
            { id: 'checkout',    name: 'Checkout & Payments',   description: 'Cart, Stripe payments, discounts, tax', default: true },
            { id: 'storefront',  name: 'Storefront & Themes',   description: 'Template gallery, page builder, custom domains', default: true },
            { id: 'fulfillment', name: 'Shipping & Fulfillment', description: 'Carriers, zones, shipment tracking', default: false },
            { id: 'ai_studio',   name: 'AI Content Studio',     description: 'AI product descriptions and image generation', default: false },
        ],
        pricing: {
            free: { label: 'Starter (first store free)', price: 0 },
            paid: { label: 'Multi-Store', price: 9.99, period: 'per additional store/mo' },
        },
    },
    {
        slug: 'inventory',
        name: 'AlohaInventory',
        shortName: 'Inventory',
        icon: 'fa-warehouse',
        color: '#06b6d4',
        gradient: 'linear-gradient(135deg,#06b6d4,#0891b2)',
        status: 'live',
        bundledIn: 'commerce',
        tagline: 'Component-level inventory with BOMs and configurable products.',
        capabilities: [
            { id: 'warehouses', name: 'Multi-Warehouse',      description: 'Unlimited locations with transfers', default: true },
            { id: 'bom',        name: 'BOM & Assemblies',     description: 'Component-level stock tracking', default: true },
            { id: 'reservations', name: 'Reservations & Reorder', description: 'Safety stock, reorder automation', default: true },
            { id: 'lot_serial', name: 'Lot & Serial Tracking', description: 'Traceability for regulated products', default: false },
        ],
        pricing: { free: { label: 'Included with AlohaCommerce', price: 0 } },
    },
    {
        slug: 'crm',
        name: 'AlohaCRM',
        shortName: 'CRM',
        icon: 'fa-users',
        color: '#10b981',
        gradient: 'linear-gradient(135deg,#10b981,#059669)',
        status: 'live',
        bundledIn: 'commerce',
        tagline: 'Contacts, pipelines, landing pages, and lead capture.',
        capabilities: [
            { id: 'contacts',      name: 'Contacts & Companies', description: 'Unified contact database with timelines', default: true },
            { id: 'pipelines',     name: 'Deals & Pipelines',    description: 'Kanban pipelines with forecasting', default: true },
            { id: 'landing_pages', name: 'Landing Pages',        description: 'Drag-and-drop landing page builder', default: false },
            { id: 'lead_scoring',  name: 'Lead Scoring',         description: 'AI-powered lead qualification', default: false },
        ],
        pricing: { free: { label: 'Included with AlohaCommerce', price: 0 } },
    },
    {
        slug: 'affiliate',
        name: 'AlohaAffiliate',
        shortName: 'Affiliate',
        icon: 'fa-handshake',
        color: '#f59e0b',
        gradient: 'linear-gradient(135deg,#f59e0b,#d97706)',
        status: 'live',
        bundledIn: 'commerce',
        tagline: 'Partner portal, tracking, commissions, and payouts.',
        capabilities: [
            { id: 'partner_portal', name: 'Partner Portal',      description: 'Branded signup and performance dashboards', default: true },
            { id: 'tracking',       name: 'Tracking & Attribution', description: 'Unique codes, click and conversion tracking', default: true },
            { id: 'payouts',        name: 'Commission Payouts',  description: 'Automated Stripe Connect payouts', default: false },
        ],
        pricing: { free: { label: 'Included with AlohaCommerce', price: 0 } },
    },
    {
        slug: 'configurator',
        name: 'AlohaConfigurator',
        shortName: 'Configurator',
        icon: 'fa-cube',
        color: '#ec4899',
        gradient: 'linear-gradient(135deg,#ec4899,#db2777)',
        status: 'live',
        bundledIn: 'commerce',
        tagline: '3D product configuration with real-time rendering.',
        capabilities: [
            { id: 'three_d_viewer', name: '3D Viewer',          description: 'Real-time Three.js rendering', default: true },
            { id: 'template_engine', name: 'Template Engine',   description: 'Rule-based configuration templates', default: true },
            { id: 'bom_generation', name: 'BOM Generation',     description: 'Automatic bill-of-materials from config', default: true },
        ],
        pricing: { free: { label: 'Included with AlohaCommerce', price: 0 } },
    },
    {
        slug: 'document',
        name: 'AlohaDocument',
        shortName: 'Document',
        icon: 'fa-file-alt',
        color: '#8b5cf6',
        gradient: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
        status: 'live',
        tagline: 'Document management with OCR, full-text search, and audit trails.',
        capabilities: [
            { id: 'upload_ocr',  name: 'Upload & OCR',        description: 'Drag-and-drop upload with automatic OCR', default: true },
            { id: 'search',      name: 'Full-text Search',    description: 'Content + metadata search with snippets', default: true },
            { id: 'metadata',    name: 'Custom Metadata',     description: 'Dynamic fields per document type', default: true },
            { id: 'versioning',  name: 'Versioning & Audit',  description: 'Unlimited version history and activity log', default: true },
        ],
        pricing: { free: { label: 'Free · 5 GB', price: 0 }, paid: { label: 'Pro', price: 19.99, period: '/mo' } },
    },
    {
        slug: 'case',
        name: 'AlohaCase',
        shortName: 'Case',
        icon: 'fa-gavel',
        color: '#6366f1',
        gradient: 'linear-gradient(135deg,#6366f1,#4338ca)',
        status: 'live',
        tagline: 'Case and docket management for legal, compliance, and regulated teams.',
        capabilities: [
            { id: 'case_types',  name: 'Case Types & Workflows', description: 'Configurable case types and statuses', default: true },
            { id: 'case_docs',   name: 'Documents in Context',   description: 'Attach and search within cases', default: true },
            { id: 'comments',    name: 'Comments & Timeline',    description: 'Append-only audit trail', default: true },
        ],
        pricing: { free: { label: 'Free · 100 cases', price: 0 }, paid: { label: 'Pro', price: 29.99, period: '/mo' } },
    },
    {
        slug: 'search',
        name: 'AlohaSearch',
        shortName: 'Search',
        icon: 'fa-magnifying-glass',
        color: '#0d9488',
        gradient: 'linear-gradient(135deg,#0d9488,#115e59)',
        status: 'live',
        tagline: 'Full-text and semantic search across every platform.',
        capabilities: [
            { id: 'full_text',    name: 'Full-Text Search',      description: 'BM25 ranking with snippets', default: true },
            { id: 'semantic',     name: 'Semantic Search',       description: 'Vector search with embeddings (coming)', default: false },
            { id: 'unified_index', name: 'Unified Index',        description: 'Cross-platform search surface (coming)', default: false },
        ],
        pricing: { free: { label: 'Included with Document/Case', price: 0 } },
    },
    {
        slug: 'backup',
        name: 'AlohaBackup',
        shortName: 'Backup',
        icon: 'fa-shield-alt',
        color: '#14b8a6',
        gradient: 'linear-gradient(135deg,#14b8a6,#0d9488)',
        status: 'live',
        tagline: 'Continuous encrypted backup across every device.',
        capabilities: [
            { id: 'continuous_sync', name: 'Continuous Sync',   description: 'Filesystem watchers, instant capture', default: true },
            { id: 'encryption',      name: 'Encryption & Dedup', description: 'AES-256 + content-addressed chunks', default: true },
            { id: 'restore',         name: 'Cross-Device Restore', description: 'Restore any file to any device', default: true },
            { id: 'version_history', name: 'Version History',   description: 'Point-in-time recovery', default: false },
        ],
        pricing: {
            free: { label: 'Free · 1 device · 5 GB', price: 0 },
            paid: { label: 'Family', price: 9.99, period: '/mo' },
        },
    },

    // ---------- Coming Soon ----------
    { slug: 'drive',        name: 'AlohaDrive',        shortName: 'Drive',        icon: 'fa-cloud',           color: '#60a5fa', gradient: 'linear-gradient(135deg,#60a5fa,#1e40af)', status: 'coming', tagline: 'Business cloud storage with virtual-disk Mount and team folder collaboration.' },
    { slug: 'deliver',      name: 'AlohaDeliver',      shortName: 'Deliver',      icon: 'fa-truck-fast',      color: '#f97316', gradient: 'linear-gradient(135deg,#f97316,#c2410c)', status: 'coming', tagline: 'Last-mile delivery with photo/video proof and notifications.' },
    { slug: 'marketing',    name: 'AlohaMarketing',    shortName: 'Marketing',    icon: 'fa-bullhorn',        color: '#f97316', gradient: 'linear-gradient(135deg,#f97316,#ea580c)', status: 'coming', tagline: 'Campaign orchestration, journey builder, and analytics.' },
    { slug: 'social',       name: 'AlohaSocial',       shortName: 'Social',       icon: 'fa-share-nodes',     color: '#ec4899', gradient: 'linear-gradient(135deg,#ec4899,#be185d)', status: 'coming', tagline: 'One composer for every social network.' },
    { slug: 'message',      name: 'AlohaMessage',      shortName: 'Message',      icon: 'fa-comments',        color: '#06b6d4', gradient: 'linear-gradient(135deg,#06b6d4,#0891b2)', status: 'coming', tagline: 'Unified message center for every channel.' },
    { slug: 'email',        name: 'AlohaEmail',        shortName: 'Email',        icon: 'fa-envelope',        color: '#fb923c', gradient: 'linear-gradient(135deg,#fb923c,#f97316)', status: 'coming', tagline: 'Transactional and drip email delivery.' },
    { slug: 'assistant',    name: 'AlohaAssistant',    shortName: 'Assistant',    icon: 'fa-phone-volume',    color: '#a855f7', gradient: 'linear-gradient(135deg,#a855f7,#7e22ce)', status: 'coming', tagline: 'Voice-enabled AI executive assistant.' },
    { slug: 'support',      name: 'AlohaSupport',      shortName: 'Support',      icon: 'fa-headset',         color: '#38bdf8', gradient: 'linear-gradient(135deg,#38bdf8,#0284c7)', status: 'coming', tagline: 'Helpdesk and ticketing with customer context.' },
    { slug: 'survey',       name: 'AlohaSurvey',       shortName: 'Survey',       icon: 'fa-poll',            color: '#06b6d4', gradient: 'linear-gradient(135deg,#06b6d4,#0891b2)', status: 'coming', tagline: 'Surveys, forms, and feedback collection.' },
    { slug: 'knowledge',    name: 'AlohaKnowledge',    shortName: 'Knowledge',    icon: 'fa-book-open',       color: '#a78bfa', gradient: 'linear-gradient(135deg,#a78bfa,#7c3aed)', status: 'coming', tagline: 'Modern knowledge base and wiki.' },
    { slug: 'training',     name: 'AlohaTraining',     shortName: 'Training',     icon: 'fa-graduation-cap',  color: '#4ade80', gradient: 'linear-gradient(135deg,#4ade80,#16a34a)', status: 'coming', tagline: 'LMS with courses, quizzes, and certifications.' },
    { slug: 'project',      name: 'AlohaProject',      shortName: 'Project',      icon: 'fa-diagram-project', color: '#6366f1', gradient: 'linear-gradient(135deg,#6366f1,#4f46e5)', status: 'coming', tagline: 'Project management with boards, sprints, and roadmaps.' },
    { slug: 'data',         name: 'AlohaData',         shortName: 'Data',         icon: 'fa-database',        color: '#0ea5e9', gradient: 'linear-gradient(135deg,#0ea5e9,#0369a1)', status: 'coming', tagline: 'Data warehouse as a service with SQL workbench.' },
    { slug: 'agent',        name: 'AlohaAgent',        shortName: 'Agent',        icon: 'fa-robot',           color: '#a855f7', gradient: 'linear-gradient(135deg,#a855f7,#7e22ce)', status: 'coming', tagline: 'AI agents that work across every platform.' },
];

function getPlatform(slug) {
    return PLATFORMS.find(p => p.slug === slug);
}

function getLivePlatforms() {
    return PLATFORMS.filter(p => p.status === 'live');
}

function getComingPlatforms() {
    return PLATFORMS.filter(p => p.status === 'coming');
}
