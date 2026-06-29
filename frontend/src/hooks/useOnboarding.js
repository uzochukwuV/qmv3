import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useOnboarding() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [progress, setProgress] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [store, setStore] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await base44.auth.me();
      setUser(me);

      const progressRecords = await base44.entities.OnboardingProgress.filter({ created_by_id: me.id });
      setProgress(progressRecords[0] || null);

      const orgs = await base44.entities.Organization.filter({ created_by_id: me.id });
      const org = orgs[0] || null;
      setOrganization(org);

      if (org) {
        const stores = await base44.entities.Store.filter({ organization_id: org.id });
        setStore(stores[0] || null);
      } else {
        setStore(null);
      }
    } catch (e) {
      // Auth might not be ready yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, user, progress, organization, store, refetch: load };
}