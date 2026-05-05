/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Alert, Box, Button, Group, Modal, Stack, Stepper, Text } from '@mantine/core';
import { type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import IconCheck from '~icons/material-symbols/check';
import IconChevronLeft from '~icons/material-symbols/chevron-left';
import IconChevronRight from '~icons/material-symbols/chevron-right';
import IconListAlt from '~icons/material-symbols/list-alt';
import IconAlertTriangle from '~icons/material-symbols/warning-outline';

export type WizardStep = {
  label: ReactNode;
  description?: string;
  content: ReactNode;
  fields?: string[]; // Field names to validate for this step
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSummary?: (values: Record<string, any>) => string | null;
};

export type FormWizardProps = {
  steps: WizardStep[];
  onComplete: (data: any) => void;
  loading?: boolean;
  onCancel?: () => void;
  onBackToList?: () => void;
  readOnly?: boolean;
  allowFreeSelect?: boolean;
  error?: string | null;
};

export const FormWizard = ({ steps, onComplete, loading, onCancel, onBackToList, readOnly = false, allowFreeSelect = false, error }: FormWizardProps) => {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const { trigger, formState, getValues } = useFormContext();
  const submittedRef = useRef(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);

  const validateStepsUpTo = async (targetStep: number): Promise<boolean> => {
    for (let i = active; i < targetStep; i++) {
      const step = steps[i];
      if (step.fields && step.fields.length > 0) {
        const isValid = await trigger(step.fields);
        if (!isValid) return false;
      }
    }
    return true;
  };

  const nextStep = async () => {
    const currentStep = steps[active];
    if (!readOnly && !allowFreeSelect && currentStep.fields && currentStep.fields.length > 0) {
      const isValid = await trigger(currentStep.fields);
      if (!isValid) return;
    }
    setActive((current) => (current < steps.length - 1 ? current + 1 : current));
  };

  const handleStepClick = async (targetStep: number) => {
    if (readOnly || allowFreeSelect) {
      setActive(targetStep);
      return;
    }
    // Allow going back freely
    if (targetStep <= active) {
      setActive(targetStep);
      return;
    }
    // Validate all intermediate steps when going forward
    const isValid = await validateStepsUpTo(targetStep);
    if (isValid) {
      setActive(targetStep);
    }
  };

  const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

  const isLastStep = active === steps.length - 1;

  // [Feature 2] Unsaved changes warning - beforeunload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (formState.isDirty && !submittedRef.current && !readOnly) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [formState.isDirty, readOnly]);

  // Mark as submitted when onComplete is called
  const handleComplete = useCallback(() => {
    submittedRef.current = true;
    onComplete(getValues());
  }, [onComplete, getValues]);

  // Handle cancel with unsaved changes check
  const handleCancel = useCallback(() => {
    if (formState.isDirty && !submittedRef.current) {
      pendingNavigationRef.current = () => onCancel?.();
      setShowLeaveModal(true);
    } else {
      onCancel?.();
    }
  }, [formState.isDirty, onCancel]);

  // [Feature 10] Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextarea = target.tagName === 'TEXTAREA';
      const isMonaco = target.closest('.monaco-editor');
      const isSelect = target.closest('[role="listbox"]') || target.closest('[role="combobox"]');
      const isDrawer = target.closest('[class*="mantine-Drawer"]');

      if (isTextarea || isMonaco || isSelect || isDrawer) return;

      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Only trigger if the focus is not on a button or input
        if (target.tagName === 'BUTTON' || target.tagName === 'INPUT') return;
        e.preventDefault();
        if (isLastStep) {
          if (!readOnly) handleComplete();
        } else {
          nextStep();
        }
      }

      if (e.key === 'Escape') {
        if (active === 0 && onCancel) {
          handleCancel();
        } else if (active > 0) {
          prevStep();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isLastStep, readOnly, handleComplete, handleCancel]);

  return (
    <Stack gap="xs" mt="xs" className="animate-fade-in">
      {/* [Feature 2] Unsaved changes modal */}
      <Modal
        opened={showLeaveModal}
        onClose={() => setShowLeaveModal(false)}
        title={t('form.unsavedChanges.title')}
        centered
        size="sm"
      >
        <Text size="sm" mb="lg">{t('form.unsavedChanges.message')}</Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="outline" color="gray" onClick={() => setShowLeaveModal(false)}>
            {t('form.unsavedChanges.stay')}
          </Button>
          <Button color="red" onClick={() => {
            setShowLeaveModal(false);
            pendingNavigationRef.current?.();
          }}>
            {t('form.unsavedChanges.leave')}
          </Button>
        </Group>
      </Modal>

      {readOnly ? (
        <Group
          gap={0}
          p={0}
          mb={0}
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-light)',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}
        >
          {steps.map((step, index) => {
            if (step.content === null) return null;
            return (
              <Button
                key={index}
                variant="subtle"
                color={active === index ? 'var(--brand)' : 'gray'}
                onClick={() => handleStepClick(index)}
                radius={0}
                h={42}
                px="lg"
                style={{
                  flex: 1,
                  fontFamily: 'Outfit, sans-serif',
                  fontWeight: active === index ? 700 : 500,
                  fontSize: '0.82rem',
                  letterSpacing: '0.02em',
                  borderBottom: active === index ? '2px solid var(--brand)' : '2px solid transparent',
                  color: active === index ? 'var(--brand)' : 'var(--text-secondary)',
                  transition: 'all 0.15s ease',
                  background: active === index ? 'var(--mantine-color-red-0, #fff5f5)' : 'transparent',
                }}
              >
                {step.label}
              </Button>
            );
          })}
        </Group>
      ) : (
        <Box p="xs" mb="0" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)' }}>
          <Stepper
            active={active}
            onStepClick={handleStepClick}
            color="var(--brand)"
            allowNextStepsSelect={allowFreeSelect}
            size="md"
            px="lg"
            styles={{
              steps: {
                alignItems: 'flex-start',
              },
              step: {
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
                flex: 1,
              },
              stepWrapper: {
                margin: 0,
              },
              stepIcon: {
                borderWidth: '2px',
                backgroundColor: 'white',
                transition: 'all var(--transition-base)',
                '&[data-completed]': {
                  backgroundColor: 'var(--brand)',
                  borderColor: 'var(--brand)',
                },
                '&[data-active]': {
                  borderColor: 'var(--brand)',
                  color: 'var(--brand)',
                  boxShadow: 'var(--shadow-glow)',
                }
              },
              separator: {
                height: '2px',
                backgroundColor: 'var(--border-light)',
                marginTop: 20,
                alignSelf: 'flex-start',
                marginLeft: -8,
                marginRight: -8,
              },
              stepBody: {
                marginLeft: 0,
                textAlign: 'center',
              },
              stepLabel: {
                fontFamily: 'Outfit, sans-serif',
                fontWeight: 700,
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                '&[data-active]': {
                  color: 'var(--text-primary)',
                }
              },
              stepDescription: {
                fontFamily: 'DM Sans, sans-serif',
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
              },
            }}
          >
            {steps.map((step, index) => {
              // [Feature 4] Step summary indicators
              const summary = index < active && step.getSummary ? step.getSummary(getValues()) : null;
              return (
                <Stepper.Step
                  key={index}
                  label={step.label}
                  description={summary || step.description}
                  icon={index + 1}
                  completedIcon={<IconCheck width="16" height="16" />}
                />
              );
            })}
          </Stepper>
        </Box>
      )}

      <Box style={{ minHeight: '300px' }} className="animate-fade-in">
        <Suspense fallback={<Text size="sm" color="var(--text-muted)" p="xl">Loading configuration...</Text>}>
          {steps[active].content}
        </Suspense>
      </Box>

      {/* [Feature 8] Error feedback on submit failure */}
      {error && isLastStep && (
        <Alert
          variant="light"
          color="red"
          icon={<IconAlertTriangle width="18" height="18" />}
          title={t('form.error.submitFailed')}
        >
          <Text size="sm">{error}</Text>
          <Text size="xs" c="dimmed" mt={4}>{t('form.error.tryAgain')}</Text>
        </Alert>
      )}

      <Group justify="space-between" mt="md" pb="xs">
        <Group>
          {!readOnly && onCancel && (
            <Button
              variant="outline"
              color="gray"
              onClick={handleCancel}
              className="Button-secondary"
            >
              {(t as any)('form.btn.cancel') || 'Cancel'}
            </Button>
          )}
        </Group>
        <Group gap="md">
          {active !== 0 && (
            <Button
              variant="subtle"
              color="gray"
              onClick={prevStep}
              leftSection={<IconChevronLeft width="18" height="18" />}
              style={{ fontWeight: 600 }}
            >
              {(t as any)('form.btn.back') || 'Back'}
            </Button>
          )}

          {!isLastStep ? (
            <Button
              onClick={nextStep}
              rightSection={<IconChevronRight width="18" height="18" />}
            >
              {(t as any)('form.btn.next') || 'Next'}
            </Button>
          ) : readOnly ? (
            onBackToList && (
              <Button
                onClick={onBackToList}
                leftSection={<IconListAlt width="18" height="18" />}
                variant="gradient"
              >
                {(t as any)('form.btn.backToList')}
              </Button>
            )
          ) : (
            <Button
              onClick={handleComplete}
              loading={loading}
              leftSection={<IconCheck width="18" height="18" />}
              style={{ boxShadow: 'var(--shadow-glow)' }}
            >
              {(t as any)('form.btn.submit') || 'Submit'}
            </Button>
          )}
        </Group>
      </Group>
    </Stack>
  );
};
