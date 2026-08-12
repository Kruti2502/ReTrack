import { supabase } from '@/lib/supabase'
import type { MotivationalMessage, Profile } from '@/types/db'

// -----------------------------------------------------------------------------
// Profiles
// -----------------------------------------------------------------------------
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, 'display_name' | 'emoji'>>,
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data as Profile
}

// -----------------------------------------------------------------------------
// Motivational messages
// -----------------------------------------------------------------------------
export async function fetchMessages(): Promise<MotivationalMessage[]> {
  const { data, error } = await supabase
    .from('motivational_messages')
    .select('*')
    .order('min_percent')
  if (error) throw error
  return (data ?? []) as MotivationalMessage[]
}

export async function createMessage(input: {
  text: string
  min_percent: number
  max_percent: number
}): Promise<MotivationalMessage> {
  const { data, error } = await supabase
    .from('motivational_messages')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as MotivationalMessage
}

export async function updateMessage(
  id: string,
  patch: Partial<Pick<MotivationalMessage, 'text' | 'min_percent' | 'max_percent' | 'is_active'>>,
): Promise<MotivationalMessage> {
  const { data, error } = await supabase
    .from('motivational_messages')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as MotivationalMessage
}

export async function deleteMessage(id: string): Promise<void> {
  const { error } = await supabase.from('motivational_messages').delete().eq('id', id)
  if (error) throw error
}
