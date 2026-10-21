// The whole conformance suite against the in-memory reference engine: runs in
// CI without databases and keeps the suite itself honest.

import { describeReservoirConformance, createReferenceReservoir } from './index.js';

describeReservoirConformance('reference', { create: createReferenceReservoir, required: true });
