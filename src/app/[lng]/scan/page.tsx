'use client';

import Navbar from '@/components/Layout/Navbar';
import { Modal } from '@/components/UI';
import QrScanner from '@/components/UI/Scanner/Scanner';
import { useRouter } from '@/navigation';
import { regexURL } from '@/utils/constants';
import {
  LaWalletTags,
  detectTransferType,
  getMultipleTagsValues,
  getTagValue,
  nowInSeconds,
  removeLightningStandard,
  useConfig,
  useIdentity,
  useNostr,
} from '@lawallet/react';
import { broadcastEvent } from '@lawallet/react/actions';
import { TransferTypes } from '@lawallet/react/types';
import { Button, Flex, Text } from '@lawallet/ui';
import { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk';
import { useTranslations } from 'next-intl';
import NimiqQrScanner from 'qr-scanner';
import { useState } from 'react';

export default function Page() {
  const [urlScanned, setUrlScanned] = useState<string>('');
  const [urlClaimBadge, setUrlClaimBadge] = useState<string>('');
  const t = useTranslations();
  const router = useRouter();
  const config = useConfig();
  const identity = useIdentity();

  const { ndk } = useNostr();

  const processExternalURL = (str: string) => {
    const url = new URL(str);
    const eventParameter = url.searchParams.get('event');

    if (!eventParameter) {
      setUrlScanned(str);
      return;
    }

    const event: NostrEvent = JSON.parse(atob(eventParameter));
    if (event) {
      const subkindValue: string = getTagValue(event.tags, 't');
      const pValues: string[] = getMultipleTagsValues(event.tags, 'p');

      if (subkindValue === LaWalletTags.CARD_TRANSFER_DONATION && pValues.includes(config.modulePubkeys.card)) {
        router.push(`${window.location.origin}/settings/cards/donation?event=${eventParameter}`);
        return;
      } else {
        setUrlScanned(str);
      }
    }
  };

  const handleScanURL = async (str: string) => {
    const url = new URL(str);
    const originURL = window.location.origin;
    const eventParameter = url.searchParams.get('event');
    const cardParameter = url.searchParams.get('c');
    const badgeParameter = url.searchParams.get('definitionid');

    console.log('url', url);

    // Add new card
    if (eventParameter) {
      // TODO: check federation
      router.push(`/settings/cards/donation?event=${eventParameter}`);
    } else if (cardParameter) {
      router.push(`/settings/cards?c=${cardParameter}`);
      return;
    }
    // Claim Badge
    else if (badgeParameter) {
      setUrlClaimBadge(str);
      return;
    } else {
      if (url.origin.startsWith(originURL)) {
        const pathname: string = url.href.replace(originURL, '');
        router.push(pathname);
        return;
      } else {
        processExternalURL(str);
      }
    }
  };

  const handleScan = (result: NimiqQrScanner.ScanResult) => {
    if (!result || !result.data) return;

    const isURL: boolean = regexURL.test(result.data);

    if (isURL) {
      handleScanURL(result.data);
      return;
    } else {
      const cleanScan: string = removeLightningStandard(result.data);
      const scanType: TransferTypes = detectTransferType(cleanScan);
      if (scanType === TransferTypes.NONE) return;

      if (scanType === TransferTypes.INVOICE) {
        router.push(`/transfer/invoice/${cleanScan.toLowerCase()}`);
        return;
      }

      router.push(`/transfer/lnurl?data=${cleanScan.toLowerCase()}`);
    }
  };

  const handleClaimBadge = async (str: string) => {
    const url = new URL(str);
    const definitionId = url.searchParams.get('definitionid');

    if (identity.pubkey && definitionId) {
      try {
        const response = await fetch(`${url.origin}/api/badge/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pubkey: identity.pubkey,
            badgeId: definitionId,
          }),
        });

        const data = await response.json();
        console.log('data', data); // debug
        const badgeAward = data.message;
        const badgeAddresses = getMultipleTagsValues(badgeAward.tags, 'a');
        console.log('1 badgeAddresses', badgeAddresses); // debug
        const badgeAddress = badgeAddresses.find((address) => {
          console.log('2 address', address); // debug
          address.includes(identity.pubkey);
        }); // rompe
        console.log('3 badgeAddress', badgeAddress); // debug

        const badgesEvent = await ndk.fetchEvent({
          kinds: [30008],
          authors: [identity.pubkey],
          '#d': ['profile_badges'],
        });

        if (!badgeAddress) throw new Error('Badge Address not found');

        const newBadge_Tags = [
          ['a', badgeAddress],
          ['e', badgeAward.id],
        ];

        const new_badgeEvent: NDKEvent = new NDKEvent(ndk, {
          kind: 30008,
          pubkey: identity.pubkey,
          created_at: nowInSeconds(),
          content: '',
          tags: badgesEvent ? [...badgesEvent.tags, ...newBadge_Tags] : [['d', 'profile_badges'], ...newBadge_Tags],
        });

        await new_badgeEvent.sign();
        const signedEvent = await new_badgeEvent.toNostrEvent();

        broadcastEvent(signedEvent, config);
        setUrlClaimBadge('');

        return;
      } catch (error) {
        console.log('error', error);
      }
    }
  };

  return (
    <>
      <Navbar showBackPage={true} title={t('SCAN_QR')} />

      <Flex justify="center" align="center" flex={1}>
        <QrScanner
          onDecode={handleScan}
          startOnLaunch={true}
          highlightScanRegion={true}
          highlightCodeOutline={true}
          constraints={{ facingMode: 'environment' }}
          preferredCamera={'environment'}
        />
      </Flex>

      <Modal title={t('URL_SCANNED_TITLE')} isOpen={Boolean(urlScanned.length)} onClose={() => null}>
        <Text>{t('URL_SCANNED_DESC', { url: urlScanned })}</Text>
        <Flex direction="column" gap={4}>
          <Flex>
            <Button onClick={() => window.open(urlScanned)}>{t('OPEN_URL')}</Button>
          </Flex>
          <Flex>
            <Button variant="borderless" onClick={() => setUrlScanned('')}>
              {t('CANCEL')}
            </Button>
          </Flex>
        </Flex>
      </Modal>

      <Modal title={t('URL_BADGE_SCANNED_TITLE')} isOpen={Boolean(urlClaimBadge.length)} onClose={() => null}>
        <Flex direction="column" gap={4}>
          <Flex>
            <Button onClick={() => handleClaimBadge(urlClaimBadge)}>{t('CLAIM_BADGE')}</Button>
          </Flex>
          <Flex>
            <Button variant="borderless" onClick={() => setUrlClaimBadge('')}>
              {t('CANCEL')}
            </Button>
          </Flex>
        </Flex>
      </Modal>
    </>
  );
}
