import React, { useState, useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  View,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Alert,
  Pressable,
  TextInput as RNTextInput,
} from 'react-native';
import {
  Text,
  Card,
  Button,
  TextInput,
  IconButton,
  Divider,
  Avatar,
} from 'react-native-paper';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useAuth } from '@/providers/AuthProvider';
import { useEventDetail } from '@/hooks/useEventDetail';
import { loadPresentUsers, useEventViews } from '@/hooks/useEventViews';
import { supabase } from '@/lib/supabase';
import { createChatGroup } from '@/lib/chat';
import { LoadingScreen } from '@/components/LoadingScreen';
import { EventDateTimePicker } from '@/components/EventDateTimePicker';
import { UserListDialog, type DialogUser } from '@/components/UserListDialog';
import { ComposerInput } from '@/components/ComposerInput';
import { LinkifiedText } from '@/components/LinkifiedText';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { getInitials } from '@/lib/format';
import { canManageEvent } from '@/lib/event-attendance';
import { sendDraft } from '@/lib/composer-state';
import { space, radius, fontSize, fontWeight, type SemanticTokens } from '@/lib/theme';
import type { AppRole } from '@/lib/roles';
import type { EventDetails, RSVPStatus } from '@ambo/database';

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

type EngagementOwner = {
  eventId: string;
  generation: number;
};

type EventEngagementState = {
  eventId: string;
  viewersOpen: boolean;
  viewers: DialogUser[] | null;
  presentOpen: boolean;
  presentUsers: DialogUser[];
};

type EditableRsvpOption = {
  clientKey: string;
  id?: string;
  label: string;
};

function createEventEngagementState(eventId: string): EventEngagementState {
  return {
    eventId,
    viewersOpen: false,
    viewers: [],
    presentOpen: false,
    presentUsers: [],
  };
}

// ─── RSVP Button Component ──────────────────────────────
interface RsvpButtonProps {
  label: string;
  icon: string;
  selected: boolean;
  color: string;
  bgColor: string;
  borderColor: string;
  count?: number;
  onPress: () => void;
  // Color of the label/icon when the button is NOT selected. The admin and
  // student screens historically differed here (textPrimary vs textSecondary),
  // so it's parameterized to preserve each role's exact appearance.
  unselectedColor: string;
  accessibilityLabel: string;
}

function RsvpButton({ label, icon, selected, color, bgColor, borderColor, count, onPress, unselectedColor, accessibilityLabel }: RsvpButtonProps) {
  const { styles, tokens } = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.rsvpChoice,
        styles.rsvpBtn,
        { borderColor: selected ? borderColor : tokens.border, backgroundColor: selected ? bgColor : tokens.surface },
        pressed && styles.rsvpChoicePressed,
      ]}
    >
      <MaterialCommunityIcons name={icon as any} size={18} color={selected ? color : tokens.textSecondary} />
      <Text
        variant="bodySmall"
        style={[styles.rsvpBtnText, { color: selected ? color : unselectedColor, fontWeight: selected ? fontWeight.bold : fontWeight.medium }]}
      >
        {label}{count !== undefined && count > 0 ? ` (${count})` : ''}
      </Text>
    </Pressable>
  );
}

// ─── RSVP Option Chip Component ─────────────────────────
interface RsvpOptionChipProps {
  label: string;
  selected: boolean;
  count: number;
  onPress: () => void;
  // Label color when the chip is NOT selected. Drifted between the two screens
  // (admin: textPrimary, student: textSecondary); parameterized to preserve it.
  unselectedColor: string;
}

function RsvpOptionChip({ label, selected, count, onPress, unselectedColor }: RsvpOptionChipProps) {
  const { styles, tokens } = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Choose ${label} RSVP`}
      style={({ pressed }) => [
        styles.rsvpChoice,
        styles.optionChip,
        selected && styles.optionChipSelected,
        pressed && styles.rsvpChoicePressed,
      ]}
    >
      {selected && <MaterialCommunityIcons name="check" size={18} color={tokens.statusGoodFg} />}
      <Text
        variant="bodySmall"
        style={[styles.optionChipText, { color: unselectedColor }, selected && styles.optionChipTextSelected]}
      >
        {label}{count > 0 ? ` (${count})` : ''}
      </Text>
    </Pressable>
  );
}

/** Event detail screen shared by the admin and student routes. */
export function EventDetailScreen({ role }: { role: AppRole }) {
  const isAdmin = role === 'admin';
  const { styles, tokens } = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const engagementGenerationRef = useRef(0);
  const committedEngagementOwnerRef = useRef<EngagementOwner | null>(null);
  const { session, userRole } = useAuth();
  const userId = session?.user?.id || '';
  const router = useRouter();
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [rsvpExplanationStatus, setRsvpExplanationStatus] = useState<'maybe' | 'no' | null>(null);
  const [rsvpExplanation, setRsvpExplanation] = useState('');
  const [savingRsvp, setSavingRsvp] = useState(false);
  const commentInputRef = useRef<RNTextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const commentComposerFocusedRef = useRef(false);
  const commentTextRef = useRef('');
  const commentPostInFlightRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [engagementState, setEngagementState] = useState(() => (
    createEventEngagementState(id)
  ));
  const currentEngagement = engagementState.eventId === id
    ? engagementState
    : createEventEngagementState(id);
  const { viewersOpen, viewers, presentOpen, presentUsers } = currentEngagement;

  // Edit form state (admin only)
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editUniform, setEditUniform] = useState('');
  const [editStartDate, setEditStartDate] = useState(new Date());
  const [editEndDate, setEditEndDate] = useState(new Date());
  const [editAllDay, setEditAllDay] = useState(false);
  const [editRsvpOptions, setEditRsvpOptions] = useState<EditableRsvpOption[]>([]);
  const newOptionKeyRef = useRef(0);

  const insets = useSafeAreaInsets();
  const {
    comments,
    rsvps,
    rsvpOptions,
    myRsvp,
    myRsvpOptionId,
    myRsvpExplanation,
    loading,
    refetch,
    updateRsvp,
    postComment,
  } = useEventDetail(id, userId);
  const { viewCount, recordView, loadViewers } = useEventViews(id, userId);

  useEffect(() => {
    const owner = {
      eventId: id,
      generation: engagementGenerationRef.current + 1,
    };
    engagementGenerationRef.current = owner.generation;
    committedEngagementOwnerRef.current = owner;
    setEngagementState((current) => (
      current.eventId === id
        ? current
        : createEventEngagementState(id)
    ));

    return () => {
      if (committedEngagementOwnerRef.current === owner) {
        committedEngagementOwnerRef.current = null;
      }
    };
  }, [id]);

  useEffect(() => {
    setRsvpExplanationStatus(null);
    setRsvpExplanation('');
    setSavingRsvp(false);
  }, [id]);

  const openRsvpExplanation = (status: 'maybe' | 'no') => {
    setRsvpExplanationStatus(status);
    setRsvpExplanation(myRsvp === status ? myRsvpExplanation || '' : '');
  };

  const saveRsvpExplanation = async () => {
    if (!rsvpExplanationStatus) return;
    const cleanExplanation = rsvpExplanation.trim();
    if (cleanExplanation.length < 50 || cleanExplanation.length > 500) return;

    setSavingRsvp(true);
    const error = await updateRsvp(
      rsvpExplanationStatus as RSVPStatus,
      undefined,
      cleanExplanation,
    );
    setSavingRsvp(false);

    if (error) {
      Alert.alert('Error', error.message || 'Failed to update RSVP');
      AccessibilityInfo.announceForAccessibility('Failed to update RSVP.');
      return;
    }

    setRsvpExplanationStatus(null);
    setRsvpExplanation('');
  };

  const dismissRsvpExplanation = () => {
    if (savingRsvp) return;
    setRsvpExplanationStatus(null);
    setRsvpExplanation('');
  };

  useEffect(() => {
    let active = true;
    setEventLoading(true);
    setEvent(null);
    async function fetchEvent() {
      const { data } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .single();
      if (active && data) {
        const e = data as EventDetails;
        setEvent(e);
        setEditTitle(e.title);
        setEditDescription(e.description || '');
        setEditUniform(e.uniform || '');
        setEditStartDate(new Date(e.start_time));
        setEditEndDate(new Date(e.end_time));
      }
      if (active) setEventLoading(false);
    }
    void fetchEvent();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!event || event.id !== id || !userId) return;
    void recordView();
  }, [event, id, recordView, userId]);

  useEffect(() => {
    if (!event || event.id !== id) return;
    const requestOwner = committedEngagementOwnerRef.current;
    if (!requestOwner || requestOwner.eventId !== id) return;
    let active = true;
    setEngagementState((current) => ({
      ...(current.eventId === id
        ? current
        : createEventEngagementState(id)),
      presentOpen: false,
      presentUsers: [],
    }));
    loadPresentUsers(id)
      .then((users) => {
        if (!active || committedEngagementOwnerRef.current !== requestOwner) return;
        setEngagementState((current) => (
          current.eventId === id
            ? { ...current, presentUsers: users }
            : current
        ));
      })
      .catch((error) => {
        if (__DEV__) console.warn('[Event Attendance] Unable to load Present list:', error);
        if (!active || committedEngagementOwnerRef.current !== requestOwner) return;
        setEngagementState((current) => (
          current.eventId === id
            ? {
                ...current,
                presentUsers: [],
              }
            : current
        ));
      });
    return () => {
      active = false;
    };
  }, [event, id]);

  if (eventLoading || !event || event.id !== id) return <LoadingScreen />;

  const canManage = canManageEvent(userId, userRole ?? role, event.created_by);
  const start = formatDateTime(event.start_time);
  const end = formatDateTime(event.end_time);

  const goingCount = rsvps.filter((r) => r.status === 'going').length;
  const maybeCount = rsvps.filter((r) => r.status === 'maybe').length;

  const handleOpenViewers = async () => {
    const requestOwner = committedEngagementOwnerRef.current;
    if (!requestOwner || requestOwner.eventId !== id) return;
    setEngagementState((current) => ({
      ...(current.eventId === id
        ? current
        : createEventEngagementState(id)),
      viewers: null,
      viewersOpen: true,
    }));
    try {
      const users = await loadViewers();
      if (committedEngagementOwnerRef.current !== requestOwner) return;
      setEngagementState((current) => (
        current.eventId === id ? { ...current, viewers: users } : current
      ));
    } catch (error) {
      if (committedEngagementOwnerRef.current !== requestOwner) return;
      const message = error instanceof Error
        ? error.message
        : 'Please check your connection and try again.';
      setEngagementState((current) => (
        current.eventId === id
          ? {
              ...current,
              viewers: [],
              viewersOpen: false,
            }
          : current
      ));
      Alert.alert(
        'Unable to Load Viewers',
        message,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Try Again',
            onPress: () => {
              if (committedEngagementOwnerRef.current === requestOwner) void handleOpenViewers();
            },
          },
        ],
      );
    }
  };

  const handlePostComment = async () => {
    if (commentPostInFlightRef.current) return;
    const submittedDraft = commentTextRef.current;
    if (!submittedDraft.trim()) return;

    commentPostInFlightRef.current = true;
    setPosting(true);
    const result = await sendDraft(submittedDraft, async (message) => {
      const error = await postComment(message);
      if (error) throw error;
    });
    if (commentTextRef.current === submittedDraft) {
      commentTextRef.current = result.draft;
      setCommentText(result.draft);
    }
    commentPostInFlightRef.current = false;
    setPosting(false);

    if (result.sent) {
      commentInputRef.current?.focus();
    } else if (result.error) {
      Alert.alert('Error', 'Failed to post comment');
      AccessibilityInfo.announceForAccessibility('Failed to post comment.');
    }
  };

  const getApiHeaders = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentSession?.access_token}`,
    };
  };

  const baseUrl = process.env.EXPO_PUBLIC_WEB_URL || process.env.EXPO_PUBLIC_API_BASE_URL || '';

  const beginEditing = () => {
    setEditTitle(event.title);
    setEditDescription(event.description || '');
    setEditUniform(event.uniform || '');
    setEditStartDate(new Date(event.start_time));
    setEditEndDate(new Date(event.end_time));
    setEditRsvpOptions(rsvpOptions.map((option) => ({
      clientKey: option.id,
      id: option.id,
      label: option.label,
    })));
    setEditing(true);
  };

  const addEditRsvpOption = () => {
    if (editRsvpOptions.length >= 10) return;
    newOptionKeyRef.current += 1;
    setEditRsvpOptions((current) => [
      ...current,
      {
        clientKey: `new-option-${newOptionKeyRef.current}`,
        label: '',
      },
    ]);
  };

  const updateEditRsvpOption = (clientKey: string, label: string) => {
    setEditRsvpOptions((current) => current.map((option) => (
      option.clientKey === clientKey ? { ...option, label } : option
    )));
  };

  const removeEditRsvpOption = (clientKey: string) => {
    setEditRsvpOptions((current) => (
      current.filter((option) => option.clientKey !== clientKey)
    ));
  };

  const moveEditRsvpOption = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= editRsvpOptions.length) return;
    setEditRsvpOptions((current) => {
      const reordered = [...current];
      [reordered[index], reordered[nextIndex]] = [
        reordered[nextIndex],
        reordered[index],
      ];
      return reordered;
    });
  };

  const saveEventEdits = async (
    cleanedOptions: Array<{ id?: string; label: string }>,
  ) => {
    setSaving(true);
    try {
      const headers = await getApiHeaders();
      const res = await fetch(`${baseUrl}/api/events/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          uniform: editUniform.trim() || null,
          start_time: editStartDate.toISOString(),
          end_time: editEndDate.toISOString(),
          rsvp_options: cleanedOptions,
        }),
      });

      const responseData = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(responseData.error || 'Failed to update event');
      }

      // Check GCal sync status from the response
      if (responseData.gcal_sync && !responseData.gcal_sync.synced) {
        Alert.alert('Event Saved', `Google Calendar sync failed: ${responseData.gcal_sync.reason}`);
      }

      setEvent({
        ...event,
        title: editTitle.trim(),
        description: editDescription.trim(),
        uniform: editUniform.trim() || undefined,
        start_time: editStartDate.toISOString(),
        end_time: editEndDate.toISOString(),
      });
      await refetch();
      setEditing(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update event');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    const cleanedOptions = editRsvpOptions.map((option) => ({
      ...(option.id && { id: option.id }),
      label: option.label.trim(),
    }));
    if (cleanedOptions.some((option) => !option.label)) {
      Alert.alert('Check RSVP Options', 'RSVP option labels cannot be blank.');
      return;
    }

    const normalizedLabels = cleanedOptions.map((option) => option.label.toLocaleLowerCase());
    if (new Set(normalizedLabels).size !== normalizedLabels.length) {
      Alert.alert('Check RSVP Options', 'Each RSVP option needs a unique name.');
      return;
    }

    const retainedIds = new Set(
      cleanedOptions.flatMap((option) => option.id ? [option.id] : []),
    );
    const removedOptions = rsvpOptions.filter((option) => !retainedIds.has(option.id));
    const removedIds = new Set(removedOptions.map((option) => option.id));
    const affectedStudents = new Set(
      rsvps
        .filter((rsvp) => (
          rsvp.status === 'going'
          && rsvp.rsvp_option_id
          && removedIds.has(rsvp.rsvp_option_id)
        ))
        .map((rsvp) => rsvp.user_id),
    ).size;

    if (affectedStudents > 0) {
      const studentLabel = affectedStudents === 1 ? 'student' : 'students';
      Alert.alert(
        'Remove RSVP option?',
        `${affectedStudents} ${studentLabel} selected ${removedOptions.map((option) => option.label).join(', ')}. They will remain marked Going, but their specific option will be cleared.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove & Save',
            style: 'destructive',
            onPress: () => saveEventEdits(cleanedOptions),
          },
        ],
      );
      return;
    }

    await saveEventEdits(cleanedOptions);
  };

  const handleDelete = () => {
    Alert.alert('Delete Event', `Are you sure you want to delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const headers = await getApiHeaders();
            const res = await fetch(`${baseUrl}/api/events/${id}`, {
              method: 'DELETE',
              headers,
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || 'Failed to delete event');
            }
            router.back();
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to delete event');
          }
        },
      },
    ]);
  };

  const handleCreateAttendeeChat = async () => {
    const rsvpIds = rsvps
      .filter((r) => r.status === 'going' || r.status === 'maybe')
      .map((r) => r.user_id);
    if (rsvpIds.length === 0) {
      Alert.alert('No attendees yet', "No one has RSVP'd going or maybe to this event.");
      return;
    }
    // Include the event organizer so the chat always has an admin present —
    // mobile doesn't otherwise enforce the "student-created groups need an
    // admin" rule, and the organizer belongs in their own event's chat.
    const participantIds = Array.from(
      new Set([...rsvpIds, ...(event.created_by ? [event.created_by] : [])]),
    );
    setCreatingChat(true);
    try {
      const groupId = await createChatGroup(userId, event.title, participantIds);
      router.push(`/(${role})/chat/${groupId}` as Parameters<typeof router.push>[0]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create chat');
    } finally {
      setCreatingChat(false);
    }
  };

  const handleSendReminder = async () => {
    setSendingReminder(true);
    try {
      const headers = await getApiHeaders();
      const res = await fetch(`${baseUrl}/api/events/${id}/send-reminder`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reminders');
      Alert.alert('Reminders Sent', `Sent to ${data.sent} attendee${data.sent !== 1 ? 's' : ''}.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send reminders');
    } finally {
      setSendingReminder(false);
    }
  };

  // Attendees grouped
  const goingAttendees = rsvps.filter((r) => r.status === 'going' && r.users);
  const maybeAttendees = rsvps.filter((r) => r.status === 'maybe' && r.users);
  const hasCustomOptions = rsvpOptions.length > 0;

  // RsvpButton unselected label color drifted between the two screens; keep each
  // role's original (admin: textPrimary, student: textSecondary).
  const rsvpUnselectedColor = isAdmin ? tokens.textPrimary : tokens.textSecondary;
  // Uniform icon color likewise drifted (admin: textPrimary, student: accent).
  const uniformIconColor = isAdmin ? tokens.textPrimary : tokens.accent;

  const keyboardOffset = Platform.OS === 'ios' ? insets.top + 44 : 0;

  const scrollToNewestComment = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const commentInput = (
    <ComposerInput
      ref={commentInputRef}
      value={commentText}
      onChangeText={(value) => {
        commentTextRef.current = value;
        setCommentText(value);
      }}
      onSend={handlePostComment}
      placeholder="Add a comment..."
      sending={posting}
      accessibilityLabel="Comment"
      sendAccessibilityLabel="Post comment"
      onFocus={() => {
        commentComposerFocusedRef.current = true;
        scrollToNewestComment();
      }}
      onBlur={() => {
        commentComposerFocusedRef.current = false;
      }}
    />
  );

  return (
    <>
      <Stack.Screen options={{ title: event.title }} />
      <KeyboardAvoidingView
        style={isAdmin ? styles.containerAdmin : styles.containerStudent}
        behavior={Platform.OS === 'ios' ? 'padding' : isAdmin ? 'height' : undefined}
        keyboardVerticalOffset={isAdmin ? keyboardOffset : 100}
      >
        <ScrollView
          ref={scrollViewRef}
          testID="event-content-scroll"
          contentContainerStyle={isAdmin ? styles.contentAdmin : styles.contentStudent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={isAdmin ? 'interactive' : undefined}
          onContentSizeChange={() => {
            if (commentComposerFocusedRef.current) scrollToNewestComment();
          }}
        >
          {/* Actions */}
          <View style={isAdmin ? styles.adminActions : styles.actionRow}>
            {canManage && (
              <IconButton
                icon="clipboard-check-outline"
                mode="outlined"
                size={20}
                iconColor={tokens.accent}
                onPress={() => router.push(
                  `/(${role})/events/attendance/${id}` as Parameters<typeof router.push>[0],
                )}
                accessibilityLabel="Take attendance for this event"
                style={styles.attendanceButton}
              />
            )}
            <View style={styles.actionSpacer} />
            <View style={styles.utilityActions}>
              {canManage && (
                <>
                  <IconButton
                    icon={editing ? 'close' : 'pencil'}
                    mode="outlined"
                    size={20}
                    onPress={() => {
                      if (editing) {
                        setEditing(false);
                      } else {
                        beginEditing();
                      }
                    }}
                    accessibilityLabel={editing ? 'Cancel editing' : 'Edit event'}
                  />
                  <IconButton
                    icon="delete"
                    mode="outlined"
                    size={20}
                    iconColor={tokens.statusBadFg}
                    onPress={handleDelete}
                    accessibilityLabel="Delete event"
                  />
                </>
              )}
              <IconButton
                icon="chat-plus-outline"
                mode="outlined"
                size={20}
                onPress={handleCreateAttendeeChat}
                loading={creatingChat}
                disabled={creatingChat}
                accessibilityLabel="Create chat with attendees"
              />
              {isAdmin && (
                <IconButton
                  icon="bell-ring-outline"
                  mode="outlined"
                  size={20}
                  onPress={handleSendReminder}
                  loading={sendingReminder}
                  disabled={sendingReminder}
                  accessibilityLabel="Send event reminder"
                />
              )}
            </View>
          </View>

          {/* Event Info or Edit Form (managers only) */}
          {canManage && editing ? (
            <View style={styles.editSection}>
              <TextInput
                mode="outlined"
                label="Title"
                value={editTitle}
                onChangeText={setEditTitle}
                dense
                style={styles.editInput}
              />
              <TextInput
                mode="outlined"
                label="Description"
                value={editDescription}
                onChangeText={setEditDescription}
                multiline
                scrollEnabled={false}
                dense
                style={[styles.editInput, styles.textAreaInput, { minHeight: 112 }]}
              />
              <TextInput
                mode="outlined"
                label="Uniform"
                value={editUniform}
                onChangeText={setEditUniform}
                multiline
                scrollEnabled={false}
                dense
                style={[styles.editInput, styles.textAreaInput, { minHeight: 72 }]}
                placeholder="e.g. Ambassador Polo with Navy Pants"
              />
              <EventDateTimePicker
                startDate={editStartDate}
                endDate={editEndDate}
                allDay={editAllDay}
                onStartDateChange={setEditStartDate}
                onEndDateChange={setEditEndDate}
                onAllDayChange={setEditAllDay}
              />
              <View style={styles.editRsvpSection}>
                <Text variant="labelMedium">RSVP Options (optional)</Text>
                <Text variant="bodySmall" style={styles.rsvpHint}>
                  Leave empty for the default Going, Maybe, and Can't Go choices.
                </Text>
                {editRsvpOptions.map((option, index) => (
                  <View key={option.clientKey} style={styles.editRsvpOptionRow}>
                    <TextInput
                      mode="outlined"
                      value={option.label}
                      onChangeText={(label) => updateEditRsvpOption(option.clientKey, label)}
                      placeholder={`Option ${index + 1}`}
                      dense
                      accessibilityLabel={`RSVP option ${index + 1}`}
                      style={styles.editRsvpOptionInput}
                    />
                    <IconButton
                      icon="arrow-up"
                      size={18}
                      disabled={index === 0}
                      onPress={() => moveEditRsvpOption(index, -1)}
                      accessibilityLabel={`Move RSVP option ${index + 1} up`}
                    />
                    <IconButton
                      icon="arrow-down"
                      size={18}
                      disabled={index === editRsvpOptions.length - 1}
                      onPress={() => moveEditRsvpOption(index, 1)}
                      accessibilityLabel={`Move RSVP option ${index + 1} down`}
                    />
                    <IconButton
                      icon="close"
                      size={18}
                      onPress={() => removeEditRsvpOption(option.clientKey)}
                      accessibilityLabel={`Remove RSVP option ${index + 1}`}
                    />
                  </View>
                ))}
                {editRsvpOptions.length < 10 && (
                  <Button
                    mode="text"
                    icon="plus"
                    onPress={addEditRsvpOption}
                    compact
                    accessibilityLabel="Add RSVP option"
                    style={styles.addOptionButton}
                  >
                    Add RSVP Option
                  </Button>
                )}
              </View>
              <Button
                mode="contained"
                onPress={handleSaveEdit}
                loading={saving}
                disabled={!editTitle.trim() || saving}
                accessibilityLabel="Save event changes"
                style={styles.saveButton}
              >
                Save Changes
              </Button>
            </View>
          ) : (
            <>
              <Text variant="headlineSmall" style={styles.title}>{event.title}</Text>

              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="calendar" size={18} color={tokens.textPrimary} />
                <Text variant="bodyMedium">{start.date}</Text>
              </View>
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="clock-outline" size={18} color={tokens.textPrimary} />
                <Text variant="bodyMedium">{start.time} - {end.time}</Text>
              </View>
              {event.uniform && (
                <Card elevation={0} style={styles.uniformCard}>
                  <Card.Content style={styles.uniformContent}>
                    <MaterialCommunityIcons name="tshirt-crew-outline" size={18} color={uniformIconColor} />
                    <LinkifiedText
                      variant="bodyMedium"
                      style={styles.uniformText}
                    >
                      {`Uniform: ${event.uniform}`}
                    </LinkifiedText>
                  </Card.Content>
                </Card>
              )}

              {event.description && (
                <>
                  <Divider style={styles.divider} />
                  <LinkifiedText variant="bodyMedium" style={styles.description}>{event.description}</LinkifiedText>
                </>
              )}
            </>
          )}

          {/* RSVP */}
          <Divider style={styles.divider} />
          <Text variant="titleMedium" style={styles.sectionTitle}>RSVP</Text>

          {hasCustomOptions ? (
            // Two-tier layout: custom options + Maybe/Can't Go
            <View style={styles.rsvpSection}>
              <Text variant="bodySmall" style={styles.rsvpGroupLabel}>I'm going to:</Text>
              <View style={styles.optionChipRow}>
                {rsvpOptions.map((opt) => {
                  const isSelected = myRsvp === 'going' && myRsvpOptionId === opt.id;
                  const count = rsvps.filter(r => r.rsvp_option_id === opt.id).length;
                  return (
                    <RsvpOptionChip
                      key={opt.id}
                      label={opt.label}
                      selected={isSelected}
                      count={count}
                      onPress={() => updateRsvp('going' as RSVPStatus, opt.id)}
                      unselectedColor={rsvpUnselectedColor}
                    />
                  );
                })}
              </View>
              <View style={styles.rsvpBtnRow}>
                <RsvpButton
                  label="Maybe"
                  icon="help-circle-outline"
                  selected={myRsvp === 'maybe'}
                  color={tokens.statusWarnFg}
                  bgColor={tokens.statusWarnBg}
                  borderColor={tokens.statusWarnBorder}
                  count={maybeCount}
                  onPress={() => openRsvpExplanation('maybe')}
                  unselectedColor={rsvpUnselectedColor}
                  accessibilityLabel="Choose Maybe RSVP"
                />
                <RsvpButton
                  label="Can't Go"
                  icon="close-circle-outline"
                  selected={myRsvp === 'no'}
                  color={tokens.textMuted}
                  bgColor={tokens.surfaceVariant}
                  borderColor={tokens.border}
                  onPress={() => openRsvpExplanation('no')}
                  unselectedColor={rsvpUnselectedColor}
                  accessibilityLabel="Choose Can't Go RSVP"
                />
              </View>
            </View>
          ) : (
            // Standard 3-button layout
            <View style={styles.rsvpBtnRow}>
              <RsvpButton
                label="Going"
                icon="check-circle-outline"
                selected={myRsvp === 'going'}
                color={tokens.statusGoodFg}
                bgColor={tokens.statusGoodBg}
                borderColor={tokens.statusGoodBorder}
                count={goingCount}
                onPress={() => updateRsvp('going' as RSVPStatus)}
                unselectedColor={rsvpUnselectedColor}
                accessibilityLabel="Choose Going RSVP"
              />
              <RsvpButton
                label="Maybe"
                icon="help-circle-outline"
                selected={myRsvp === 'maybe'}
                color={tokens.statusWarnFg}
                bgColor={tokens.statusWarnBg}
                borderColor={tokens.statusWarnBorder}
                count={maybeCount}
                onPress={() => openRsvpExplanation('maybe')}
                unselectedColor={rsvpUnselectedColor}
                accessibilityLabel="Choose Maybe RSVP"
              />
              <RsvpButton
                label="Can't Go"
                icon="close-circle-outline"
                selected={myRsvp === 'no'}
                color={tokens.textMuted}
                bgColor={tokens.surfaceVariant}
                borderColor={tokens.border}
                onPress={() => openRsvpExplanation('no')}
                unselectedColor={rsvpUnselectedColor}
                accessibilityLabel="Choose Can't Go RSVP"
              />
            </View>
          )}

          <View style={styles.engagementRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Seen by ${viewCount} ${viewCount === 1 ? 'person' : 'people'}`}
              onPress={() => void handleOpenViewers()}
              style={({ pressed }) => [styles.engagementButton, pressed && styles.engagementButtonPressed]}
            >
              <MaterialCommunityIcons name="eye-outline" size={18} color={tokens.textSecondary} />
              <Text variant="bodySmall" style={styles.engagementText}>{viewCount} seen</Text>
            </Pressable>
            {presentUsers.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Show ${presentUsers.length} present ${presentUsers.length === 1 ? 'person' : 'people'}`}
                onPress={() => setEngagementState((current) => (
                  current.eventId === id
                    ? { ...current, presentOpen: true }
                    : current
                ))}
                style={({ pressed }) => [styles.engagementButton, pressed && styles.engagementButtonPressed]}
              >
                <MaterialCommunityIcons name="account-check-outline" size={18} color={tokens.statusGoodFg} />
                <Text variant="bodySmall" style={styles.presentText}>Present ({presentUsers.length})</Text>
              </Pressable>
            )}
          </View>

          {/* Attendees */}
          {hasCustomOptions ? (
            <View style={styles.attendeesSection}>
              {rsvpOptions.map((opt) => {
                const optRsvps = rsvps.filter(r => r.rsvp_option_id === opt.id && r.users);
                if (optRsvps.length === 0) return null;
                return (
                  <View key={opt.id} style={styles.attendeeGroup}>
                    <Text variant="bodySmall" style={styles.attendeesLabel}>{opt.label}:</Text>
                    <Text variant="bodySmall" style={styles.attendeesText}>
                      {optRsvps.map(r => `${r.users.first_name} ${r.users.last_name}`).join(', ')}
                    </Text>
                  </View>
                );
              })}
              {maybeAttendees.length > 0 && (
                <View style={styles.attendeeGroup}>
                  <Text variant="bodySmall" style={styles.attendeesLabel}>Maybe:</Text>
                  <Text variant="bodySmall" style={styles.attendeesText}>
                    {maybeAttendees.map(r => `${r.users.first_name} ${r.users.last_name}`).join(', ')}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.attendeesSection}>
              {goingAttendees.length > 0 && (
                <View style={styles.attendeeGroup}>
                  <Text variant="bodySmall" style={styles.attendeesLabel}>Going:</Text>
                  <Text variant="bodySmall" style={styles.attendeesText}>
                    {goingAttendees.map((r) => `${r.users.first_name} ${r.users.last_name}`).join(', ')}
                  </Text>
                </View>
              )}
              {maybeAttendees.length > 0 && (
                <View style={styles.attendeeGroup}>
                  <Text variant="bodySmall" style={styles.attendeesLabel}>Maybe:</Text>
                  <Text variant="bodySmall" style={styles.attendeesText}>
                    {maybeAttendees.map((r) => `${r.users.first_name} ${r.users.last_name}`).join(', ')}
                  </Text>
                </View>
              )}
            </View>
          )}

          {isAdmin && rsvps.some((rsvp) => (
            (rsvp.status === 'maybe' || rsvp.status === 'no') && rsvp.explanation
          )) && (
            <View style={styles.explanationsSection}>
              <Text variant="titleSmall" style={styles.explanationsTitle}>RSVP explanations</Text>
              {rsvps
                .filter((rsvp) => (
                  (rsvp.status === 'maybe' || rsvp.status === 'no')
                  && rsvp.explanation
                  && rsvp.users
                ))
                .map((rsvp) => (
                  <View key={rsvp.user_id} style={styles.explanationCard}>
                    <Text variant="bodySmall" style={styles.explanationAuthor}>
                      {rsvp.users.first_name} {rsvp.users.last_name} · {rsvp.status === 'maybe' ? 'Maybe' : "Can't Go"}
                    </Text>
                    <Text variant="bodyMedium" style={styles.explanationText}>
                      {rsvp.explanation}
                    </Text>
                  </View>
                ))}
            </View>
          )}

          {/* Comments */}
          <Divider style={styles.divider} />
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Comments ({comments.length})
          </Text>

          {comments.filter((c) => c.users).map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <Avatar.Text
                size={32}
                label={getInitials(comment.users.first_name, comment.users.last_name)}
                style={styles.commentAvatar}
              />
              <View style={styles.commentBody}>
                <Text variant="bodySmall" style={styles.commentAuthor}>
                  {comment.users.first_name} {comment.users.last_name}
                </Text>
                <LinkifiedText variant="bodyMedium">{comment.content}</LinkifiedText>
                <Text variant="labelSmall" style={styles.commentTime}>
                  {new Date(comment.created_at).toLocaleDateString()}
                </Text>
              </View>
            </View>
          ))}

        </ScrollView>

        {commentInput}
      </KeyboardAvoidingView>
      <Modal
        visible={rsvpExplanationStatus !== null}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        onRequestClose={dismissRsvpExplanation}
      >
        <View style={styles.explanationModalOverlay} accessibilityViewIsModal>
          <Pressable
            style={styles.explanationBackdrop}
            onPress={dismissRsvpExplanation}
            accessibilityRole="button"
            accessibilityLabel="Close RSVP explanation"
          />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.dialogKeyboardAvoider}
          pointerEvents="box-none"
        >
          <View style={styles.explanationDialog}>
            <View style={styles.explanationDialogContent}>
              <Text variant="headlineSmall" style={styles.explanationDialogTitle}>
                Explain your {rsvpExplanationStatus === 'maybe' ? 'Maybe' : "Can't Go"} RSVP
              </Text>
              <Text variant="bodySmall" style={styles.explanationPrompt}>
                Please explain your response in 50–500 characters. Only admins can view it.
              </Text>
              <TextInput
                mode="outlined"
                multiline
                numberOfLines={5}
                value={rsvpExplanation}
                onChangeText={setRsvpExplanation}
                maxLength={500}
                accessibilityLabel="RSVP explanation"
                style={styles.explanationInput}
              />
              <Text variant="labelSmall" style={styles.explanationCount}>
                {rsvpExplanation.trim().length}/500 characters
              </Text>
              <View style={styles.explanationActions}>
                <Button
                  onPress={() => {
                    setRsvpExplanationStatus(null);
                    setRsvpExplanation('');
                  }}
                  disabled={savingRsvp}
                >
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  onPress={() => void saveRsvpExplanation()}
                  loading={savingRsvp}
                  disabled={
                    savingRsvp
                    || rsvpExplanation.trim().length < 50
                    || rsvpExplanation.trim().length > 500
                  }
                  accessibilityLabel="Save RSVP"
                >
                  Save RSVP
                </Button>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
        </View>
      </Modal>
      <UserListDialog
        visible={viewersOpen}
        title={`Seen by ${viewCount}`}
        users={viewers}
        onDismiss={() => setEngagementState((current) => (
          current.eventId === id
            ? { ...current, viewersOpen: false }
            : current
        ))}
      />
      <UserListDialog
        visible={presentOpen}
        title={`Present (${presentUsers.length})`}
        users={presentUsers}
        onDismiss={() => setEngagementState((current) => (
          current.eventId === id
            ? { ...current, presentOpen: false }
            : current
        ))}
      />
    </>
  );
}

const makeStyles = (t: SemanticTokens) => StyleSheet.create({
  // container background drifted between roles (admin: surface, student:
  // background); preserved per-role via containerAdmin/containerStudent.
  containerAdmin: { flex: 1, backgroundColor: t.surface },
  containerStudent: { flex: 1, backgroundColor: t.background },
  // content paddingBottom drifted (admin: 16, student: 32); preserved per-role.
  contentAdmin: { padding: space.lg, paddingBottom: space.lg },
  contentStudent: { padding: space.lg, paddingBottom: space.xxl },
  adminActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.lg },
  actionSpacer: { flex: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  utilityActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  attendanceButton: { borderColor: t.accent },
  editSection: { gap: space.md, marginBottom: space.sm },
  editInput: { backgroundColor: t.surface },
  textAreaInput: { textAlignVertical: 'top' },
  editRsvpSection: { gap: space.xs },
  rsvpHint: { color: t.textSecondary },
  editRsvpOptionRow: { flexDirection: 'row', alignItems: 'center' },
  editRsvpOptionInput: { flex: 1, backgroundColor: t.surface },
  addOptionButton: { alignSelf: 'flex-start' },
  saveButton: { borderRadius: radius.md, marginTop: space.xs },
  title: { fontWeight: fontWeight.bold, marginBottom: space.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  uniformCard: { backgroundColor: t.accentContainer, marginTop: space.md },
  uniformContent: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  uniformText: { color: t.accent },
  divider: { marginVertical: space.lg },
  description: { color: t.textSecondary, lineHeight: 22 },
  sectionTitle: { fontWeight: fontWeight.semibold, marginBottom: space.md },

  // RSVP section
  rsvpSection: { gap: space.md, marginBottom: space.md },
  rsvpGroupLabel: { color: t.textSecondary, fontWeight: fontWeight.medium },
  rsvpBtnRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  rsvpChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 46,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  rsvpChoicePressed: { opacity: 0.7 },
  rsvpBtn: { flex: 1 },
  rsvpBtnText: { fontSize: fontSize.sm },
  engagementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginBottom: space.md },
  engagementButton: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs },
  engagementButtonPressed: { opacity: 0.65 },
  engagementText: { color: t.textSecondary, fontWeight: fontWeight.medium },
  presentText: { color: t.statusGoodFg, fontWeight: fontWeight.semibold },

  // Custom option chips
  optionChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  optionChip: {
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  optionChipSelected: {
    backgroundColor: t.statusGoodBg,
    borderColor: t.statusGoodBorder,
  },
  optionChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  optionChipTextSelected: { color: t.statusGoodFg, fontWeight: fontWeight.bold },

  // Attendees
  attendeesSection: { gap: space.sm, marginBottom: space.xs },
  attendeeGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  attendeesLabel: { fontWeight: fontWeight.semibold, color: t.textSecondary },
  attendeesText: { color: t.textSecondary, flex: 1 },
  explanationsSection: { gap: space.sm, marginTop: space.md },
  explanationsTitle: { fontWeight: fontWeight.semibold },
  explanationCard: {
    gap: space.xs,
    padding: space.md,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    backgroundColor: t.surfaceVariant,
  },
  explanationAuthor: { fontWeight: fontWeight.semibold, color: t.textSecondary },
  explanationText: { color: t.textPrimary },
  explanationPrompt: { color: t.textSecondary, marginBottom: space.sm },
  explanationInput: { backgroundColor: t.surface },
  explanationCount: { color: t.textMuted, textAlign: 'right', marginTop: space.xs },
  explanationActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.md },
  explanationModalOverlay: { flex: 1 },
  explanationBackdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: t.textPrimary,
    opacity: 0.32,
  },
  dialogKeyboardAvoider: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  explanationDialog: {
    width: '100%',
    maxHeight: '100%',
    borderRadius: radius.lg,
    backgroundColor: t.surface,
  },
  explanationDialogContent: { padding: space.xl },
  explanationDialogTitle: { marginBottom: space.lg },

  // Comments
  comment: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  commentAvatar: { backgroundColor: t.surfaceVariant },
  commentBody: { flex: 1 },
  commentAuthor: { fontWeight: fontWeight.semibold, marginBottom: space.xxs },
  commentTime: { color: t.textMuted, marginTop: space.xs },
});
