export const IPC_CHANNELS = {
  devicesList: "devices:list",
  devicesAddLocal: "devices:addLocal",
  devicesAddSsh: "devices:addSsh",
  devicesConnect: "devices:connect",
  devicesDisconnect: "devices:disconnect",
  devicesRemove: "devices:remove",
  searchUpsertThread: "search:upsertThread",
  searchRemoveDevice: "search:removeDevice",
  searchQuery: "search:query",
  searchBootstrapStatus: "search:bootstrapStatus",
  themeGetPreference: "theme:getPreference",
  themeSetPreference: "theme:setPreference",
  themeUpdated: "theme:updated",
  diagnosticsRecordLifecycle: "diagnostics:recordLifecycle",
  diagnosticsSnapshotState: "diagnostics:snapshotState",
  diagnosticsReadState: "diagnostics:readState"
} as const;
