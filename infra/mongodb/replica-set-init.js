// Reference initialization for disposable Phase 3 MongoDB tests.
// The npm harness generates the member host list and runs rs.initiate itself.
// Never point this at production data.
rs.initiate({
  _id: 'rs0',
  members: [
    { _id: 0, host: 'host.docker.internal:27018' },
    { _id: 1, host: 'host.docker.internal:27019' },
    { _id: 2, host: 'host.docker.internal:27020' },
  ],
});
