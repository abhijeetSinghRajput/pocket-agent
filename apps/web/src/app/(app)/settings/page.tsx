import { redirect } from 'next/navigation';

/** Settings live on the profile page now. */
export default function SettingsPage() {
  redirect('/profile');
}
