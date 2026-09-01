import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Flex, Form, Input, Result, Skeleton, Typography } from 'antd'
import { ApiError } from '@/lib/apiClient'
import {
  checkResetToken,
  completePasswordReset,
  mapAuthError,
} from '@/services/auth'
import { useAuth } from '@/app/providers/AuthProvider'
import { parseResetToken } from '@/pages/auth/parseResetToken'
import { actions, passwordReset } from '@/shared/i18n/ru'

interface FormValues {
  next: string
  repeat: string
}

/** Экран после успешной смены, когда на устройстве открыт ЧУЖОЙ аккаунт. */
interface OtherUserState {
  email: string
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { loading: authLoading, adoptSession, resolveLocalDataOwner, signOut, user } = useAuth()

  // Лениво, ДО эффектов: под React.StrictMode эффекты в dev выполняются
  // дважды, и чтение хэша в одном эффекте с его очисткой потеряло бы токен.
  const [token] = useState(() => parseResetToken(window.location.hash))

  const [checking, setChecking] = useState(true)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [otherUser, setOtherUser] = useState<OtherUserState | null>(null)

  // Убираем токен из адресной строки и истории сразу после чтения.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    // Ждём восстановления сессии: фоновый restoreSession, финишировав позже
    // нас, перетёр бы только что принятую сессию.
    if (authLoading) return
    if (!token) {
      setTokenError(passwordReset.resetInvalidTitle)
      setChecking(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const info = await checkResetToken(token)
        if (!cancelled) setMaskedEmail(info.email_masked)
      } catch (e) {
        if (!cancelled) setTokenError(mapAuthError(e))
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, token])

  async function handleSubmit(values: FormValues) {
    if (!token) return
    setFormError(null)
    setSaving(true)
    try {
      const data = await completePasswordReset(token, values.next)

      // Кому принадлежат локальные данные устройства. Проверять `user` нельзя:
      // после 401 сессии нет, а отчёты и фото прежнего пользователя остались.
      const owner = await resolveLocalDataOwner()
      if (owner && owner !== data.session.user.id) {
        // Чужой аккаунт не трогаем вовсе: принятие сессии здесь запустило бы
        // удаление его несинхронизированных данных.
        setOtherUser({ email: user?.email ?? '' })
        return
      }

      await adoptSession(data, { persistent: false })
      navigate('/reports', { replace: true })
    } catch (e) {
      // Пароль мог смениться, даже если сюда прилетела ошибка: сеть отвалилась
      // после коммита, 5xx после успешной записи, падение применения сессии.
      const ambiguous = !(e instanceof ApiError) || e.status === 0 || e.status >= 500
      setFormError(ambiguous ? passwordReset.ambiguous : mapAuthError(e))
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || checking) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    )
  }

  if (otherUser) {
    return (
      <Card>
        <Result
          status="success"
          title={passwordReset.resetDoneTitle}
          subTitle={passwordReset.resetDoneOtherUser(otherUser.email)}
          extra={
            <Button
              type="primary"
              onClick={async () => {
                // Штатный выход: там уже есть подтверждение с числом
                // несинхронизированных отчётов. Отмену уважаем.
                if (await signOut()) navigate('/login', { replace: true })
              }}
            >
              {passwordReset.switchAccount}
            </Button>
          }
        />
      </Card>
    )
  }

  if (tokenError) {
    return (
      <Card>
        <Result
          status="error"
          title={passwordReset.resetInvalidTitle}
          subTitle={tokenError}
          extra={<Link to="/forgot-password">{passwordReset.requestNew}</Link>}
        />
      </Card>
    )
  }

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {passwordReset.resetTitle}
      </Typography.Title>
      {maskedEmail ? (
        <Typography.Paragraph type="secondary">
          {passwordReset.resetFor(maskedEmail)}
        </Typography.Paragraph>
      ) : null}

      {formError ? (
        <Alert type="error" message={formError} showIcon style={{ marginBottom: 16 }} />
      ) : null}

      <Form<FormValues> layout="vertical" onFinish={handleSubmit} disabled={saving}>
        <Form.Item
          name="next"
          label={passwordReset.newLabel}
          rules={[
            { required: true, message: 'Введите новый пароль' },
            { min: 6, message: 'Пароль должен быть не короче 6 символов' },
            {
              // bcrypt читает только первые 72 байта — граница в байтах,
              // а кириллица занимает по два.
              validator: (_, value: string) =>
                !value || new TextEncoder().encode(value).length <= 72
                  ? Promise.resolve()
                  : Promise.reject(new Error('Не более 72 байт')),
            },
          ]}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {passwordReset.lengthHint}
            </Typography.Text>
          }
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="repeat"
          label={passwordReset.repeatLabel}
          dependencies={['next']}
          rules={[
            { required: true, message: 'Повторите новый пароль' },
            ({ getFieldValue }) => ({
              validator: (_, value: string) =>
                !value || getFieldValue('next') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error(passwordReset.repeatMismatch)),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={saving}>
          {passwordReset.resetSubmit}
        </Button>
      </Form>

      <Flex justify="center" style={{ marginTop: 16 }}>
        <Link to="/login">{actions.signIn}</Link>
      </Flex>
    </Card>
  )
}
