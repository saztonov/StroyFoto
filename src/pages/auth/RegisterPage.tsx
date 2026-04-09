import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Flex, Form, Input, Result, Typography } from 'antd'
import { mapAuthError, signUpWithEmail } from '@/services/auth'
import { actions, auth } from '@/shared/i18n/ru'

interface FormValues {
  fullName: string
  email: string
  password: string
}

export function RegisterPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false)

  const handleSubmit = async (values: FormValues) => {
    setError(null)
    setLoading(true)
    try {
      const result = await signUpWithEmail(values.email, values.password, values.fullName)
      if (result.session) {
        // Email-confirm выключен — сразу авторизованы, идём ждать активации.
        navigate('/pending-activation', { replace: true })
      } else {
        // Email-confirm включён — нужна явная инструкция, не молчаливый редирект.
        setNeedsEmailConfirm(true)
      }
    } catch (e) {
      setError(mapAuthError(e))
    } finally {
      setLoading(false)
    }
  }

  if (needsEmailConfirm) {
    return (
      <Card>
        <Result
          status="success"
          title={auth.registerSuccessTitle}
          subTitle={auth.checkEmail}
          extra={
            <Button type="primary" onClick={() => navigate('/login', { replace: true })}>
              {auth.goToLogin}
            </Button>
          }
        />
      </Card>
    )
  }

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {auth.registerTitle}
      </Typography.Title>

      {error ? (
        <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
      ) : null}

      <Form<FormValues> layout="vertical" onFinish={handleSubmit} disabled={loading}>
        <Form.Item
          label="ФИО"
          name="fullName"
          rules={[{ required: true, message: 'Введите ФИО' }]}
        >
          <Input autoComplete="name" placeholder="Иванов Иван Иванович" />
        </Form.Item>

        <Form.Item
          label={auth.emailLabel}
          name="email"
          rules={[
            { required: true, message: 'Введите электронную почту' },
            { type: 'email', message: 'Неверный формат электронной почты' },
          ]}
        >
          <Input autoComplete="email" placeholder={auth.emailPlaceholder} />
        </Form.Item>

        <Form.Item
          label={auth.passwordLabel}
          name="password"
          rules={[
            { required: true, message: 'Введите пароль' },
            { min: 6, message: 'Минимум 6 символов' },
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder={auth.passwordPlaceholder} />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={loading}>
          {actions.signUp}
        </Button>
      </Form>

      <Flex justify="center" gap={6} style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">{auth.hasAccount}</Typography.Text>
        <Link to="/login">{actions.signIn}</Link>
      </Flex>
    </Card>
  )
}
