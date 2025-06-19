export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Voter {
  id: number;
  wallet_address: string;
  name?: string;          // cualquier otro campo que tengas en tu tabla public.voter
  created_at: string;
}

export interface Campaign {
  id: number;
  creator_wallet: string;
  title: string;
  options: string[];      // asumiendo que guardas JSONB en Supabase
  nft_mint: string;
  start_time: string;     // timestamptz
  end_time: string;       // timestamptz
  created_at: string;
}

export interface VoterCampaign {
  id: number;
  voter_id: number;
  campaign_id: number;
  has_voted: boolean;
  registered_at: string;
  voted_at: string | null;
}

export interface VoteTokenIssuance {
  id: number;
  voter_id: number;
  campaign_id: number;
  nft_mint: string;
  issued_at: string;
}

export interface VoteResultIndexed {
  id: number;
  campaign_id: number;
  voter_address: string;
  option_index: number;
  occurred_at: string;
}
