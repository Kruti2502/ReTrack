import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDay, fetchHistory, fetchJourneyStats } from '@/api/day'
import { fetchActivePlan, fetchActivities } from '@/api/plan'
import { fetchGallery, type GalleryFilters } from '@/api/proof'
import { fetchPendingSubmissions } from '@/api/review'
import { fetchMessages } from '@/api/settings'

export const keys = {
  day: (date?: string | null) => ['day', date ?? 'today'] as const,
  journey: ['journey'] as const,
  history: (from: string, to: string) => ['history', from, to] as const,
  pending: ['pending-submissions'] as const,
  activities: (includeArchived: boolean) => ['activities', includeArchived] as const,
  plan: ['active-plan'] as const,
  gallery: (filters: GalleryFilters) => ['gallery', filters] as const,
  messages: ['motivational-messages'] as const,
}

export function useDay(date?: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.day(date),
    queryFn: () => fetchDay(date ?? undefined),
    enabled: options?.enabled ?? true,
    // A running timer is drawn from the last server snapshot, so a light
    // refetch keeps two devices in agreement without hammering the database.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useJourney() {
  return useQuery({ queryKey: keys.journey, queryFn: fetchJourneyStats })
}

export function useHistory(from: string, to: string) {
  return useQuery({ queryKey: keys.history(from, to), queryFn: () => fetchHistory(from, to) })
}

export function usePendingSubmissions() {
  return useQuery({
    queryKey: keys.pending,
    queryFn: fetchPendingSubmissions,
    refetchInterval: 60_000,
  })
}

export function useActivities(includeArchived = false) {
  return useQuery({
    queryKey: keys.activities(includeArchived),
    queryFn: () => fetchActivities(includeArchived),
  })
}

export function useActivePlan() {
  return useQuery({ queryKey: keys.plan, queryFn: fetchActivePlan })
}

export function useGallery(filters: GalleryFilters) {
  return useQuery({ queryKey: keys.gallery(filters), queryFn: () => fetchGallery(filters) })
}

export function useMessages() {
  return useQuery({ queryKey: keys.messages, queryFn: fetchMessages })
}

/**
 * Anything that changes progress invalidates the same small set of queries,
 * so a screen never shows a stale percentage after an action.
 */
export function useProgressInvalidation() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['day'] })
    void client.invalidateQueries({ queryKey: keys.journey })
    void client.invalidateQueries({ queryKey: ['history'] })
    void client.invalidateQueries({ queryKey: keys.pending })
  }
}

/** Small helper so mutations get consistent invalidation without boilerplate. */
export function useProgressMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const invalidate = useProgressInvalidation()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidate(),
  })
}
