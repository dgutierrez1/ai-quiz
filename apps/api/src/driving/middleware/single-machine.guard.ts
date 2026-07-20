export function assertSingleMachine(env: {
  FLY_APP_NAME?: string;
  MAX_MACHINES_RUNNING?: string;
}): void {
  if (env.FLY_APP_NAME && env.MAX_MACHINES_RUNNING !== '1')
    throw new Error('Fly deployment requires MAX_MACHINES_RUNNING=1');
}
