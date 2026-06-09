export type UserRole = 'client' | 'legal_advisor' | 'admin';

export interface AuthUser {
  id: string;
  fullName: string;
  username: string;
  role: UserRole;
}
