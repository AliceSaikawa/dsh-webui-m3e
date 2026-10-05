import type { SessionReference } from '../../dsh/services.ts'

// A pending send may outlive a Composer. Its current mounted replacement owns navigation.
const destinations = new Map<string, (reference: SessionReference) => void>()
export function registerDeliveryDestination(key: string, destination: (reference: SessionReference) => void): () => void {
  destinations.set(key, destination)
  return () => { if (destinations.get(key) === destination) destinations.delete(key) }
}
export function handoffDeliveryDestination(key: string, reference: SessionReference): void {
  destinations.get(key)?.(reference)
}
