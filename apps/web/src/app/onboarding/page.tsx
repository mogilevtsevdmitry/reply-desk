import type { Metadata } from 'next';
import { RequireOnboarding } from '@/components/guards';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';

export const metadata: Metadata = { title: 'ReplyDesk — настройка компании' };

export default function OnboardingPage() {
  return (
    <RequireOnboarding>
      <OnboardingWizard />
    </RequireOnboarding>
  );
}
