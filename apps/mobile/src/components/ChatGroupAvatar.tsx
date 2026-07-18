import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { radius, space, type SemanticTokens } from '@/lib/theme';

interface ChatParticipant {
  user_id: string;
  users: {
    first_name: string;
    last_name: string;
    avatar_url?: string;
  };
}

interface ChatGroupAvatarProps {
  participants: ChatParticipant[];
  currentUserId: string;
  displayName: string;
}

/** Direct-chat avatar or a compact two-person composite for group chats. */
export function ChatGroupAvatar({ participants, currentUserId, displayName }: ChatGroupAvatarProps) {
  const { styles } = useThemedStyles(makeStyles);
  const others = participants.filter((participant) => participant.user_id !== currentUserId);

  if (others.length <= 1) {
    const participant = others[0];
    return (
      <View importantForAccessibility="no-hide-descendants">
        <Avatar
          uri={participant?.users.avatar_url}
          firstName={participant?.users.first_name ?? displayName}
          lastName={participant?.users.last_name}
          size={44}
        />
      </View>
    );
  }

  return (
    <View style={styles.composite} importantForAccessibility="no-hide-descendants">
      {others.slice(0, 2).map((participant, index) => (
        <View
          key={participant.user_id}
          style={[styles.compositeAvatar, index === 0 ? styles.firstAvatar : styles.secondAvatar]}
        >
          <Avatar
            uri={participant.users.avatar_url}
            firstName={participant.users.first_name}
            lastName={participant.users.last_name}
            size={28}
          />
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  composite: { width: 44, height: 44 },
  compositeAvatar: {
    position: 'absolute',
    width: 32,
    height: 32,
    padding: space.xxs,
    borderRadius: radius.pill,
    backgroundColor: t.surface,
  },
  firstAvatar: { top: 0, left: 0 },
  secondAvatar: { right: 0, bottom: 0 },
});
