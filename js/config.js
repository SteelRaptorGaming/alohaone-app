// =============================================================================
// AlohaOne App — Runtime config
// -----------------------------------------------------------------------------
// Single source of truth for the Cognito user pool + cross-platform API URLs
// used by login.html, register.html, and the shell.
//
// The Cognito pool is shared with AlohaCommerce and AlohaBackup. The client ID
// here is the same one AlohaCommerce admin uses, which means signing up through
// AlohaOneApp produces exactly the same Cognito user as signing up through the
// old Commerce admin form — no silo.
// =============================================================================

window.ALOHAONE_CONFIG = {
    COGNITO_REGION:    'us-east-1',
    COGNITO_POOL_ID:   'us-east-1_25nTKMaY4',
    COGNITO_CLIENT_ID: 'n9306pn18r2g9ha6l3r0rnhj1',
    COGNITO_ENDPOINT:  'https://cognito-idp.us-east-1.amazonaws.com/',

    // AlohaCommerce API — where /api/auth/sync lives (auto-provisions the
    // user's default store on first login).
    COMMERCE_API_BASE: 'https://rdadh5e9q2.execute-api.us-east-1.amazonaws.com',

    // AlohaBackup API — for future first-login provisioning via its own sync.
    BACKUP_API_BASE:   'https://jug8ugnbt8.execute-api.us-east-1.amazonaws.com',
};
