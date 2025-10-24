/**
 * Dependency-cruiser configuration
 * Enforces architectural boundaries in the backend.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-db-to-services',
      severity: 'error',
      comment: 'Database layer must not depend on service-layer modules.',
      from: {
        path: '^backend/src/db/'
      },
      to: {
        path: '^backend/src/services/(?!googleSync\\.ts$)'
      }
    }
  ],
  options: {
    tsConfig: {
      fileName: './tsconfig.depcruise.json'
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+'
      }
    }
  }
};
