import { resolve } from "node:path";
import {
  parseHarnessRuntimeContract,
  type HarnessRuntimeContract,
  type ParseHarnessRuntimeContractInput
} from "../../src/shared/harness/runContract.ts";

export interface NodeHarnessRuntimeContract extends HarnessRuntimeContract {
  artifacts: HarnessRuntimeContract["artifacts"] & {
    rootAbsolutePath: string;
    runsAbsolutePath: string;
    runAbsolutePath: string;
  };
}

export const resolveHarnessRuntimeContract = (
  input: ParseHarnessRuntimeContractInput & { cwd?: string } = {}
): NodeHarnessRuntimeContract => {
  const contract = parseHarnessRuntimeContract(input);
  const cwd = input.cwd ?? process.cwd();

  const rootAbsolutePath = resolve(cwd, contract.artifacts.root);
  const runsAbsolutePath = resolve(rootAbsolutePath, contract.artifacts.runsDirectoryName);

  return {
    ...contract,
    artifacts: {
      ...contract.artifacts,
      rootAbsolutePath,
      runsAbsolutePath,
      runAbsolutePath: resolve(rootAbsolutePath, contract.artifacts.runRelativeDirectory)
    }
  };
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const contract = resolveHarnessRuntimeContract({
    argv: process.argv.slice(2),
    env: process.env
  });
  process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
}
