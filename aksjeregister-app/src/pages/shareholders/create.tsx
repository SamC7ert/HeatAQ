import { Create, useForm } from "@refinedev/antd";
import { Form, Input, Radio, DatePicker, Row, Col, Card, Select } from "antd";
import { UserOutlined, BankOutlined } from "@ant-design/icons";
import { useState } from "react";
import type { Shareholder, ShareholderType } from "../../types/database";

const { Option } = Select;

// Common country codes
const countries = [
  { code: "NO", name: "Norge" },
  { code: "SE", name: "Sverige" },
  { code: "DK", name: "Danmark" },
  { code: "FI", name: "Finland" },
  { code: "DE", name: "Tyskland" },
  { code: "GB", name: "Storbritannia" },
  { code: "US", name: "USA" },
  { code: "NL", name: "Nederland" },
];

export const ShareholderCreate: React.FC = () => {
  const { formProps, saveButtonProps } = useForm<Shareholder>();
  const [shareholderType, setShareholderType] = useState<ShareholderType>("person");

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        initialValues={{
          shareholder_type: "person",
          country: "NO",
        }}
      >
        <Card title="Type aksjonær" size="small" style={{ marginBottom: 24 }}>
          <Form.Item
            name="shareholder_type"
            rules={[{ required: true }]}
          >
            <Radio.Group
              onChange={(e) => setShareholderType(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              size="large"
            >
              <Radio.Button value="person">
                <UserOutlined /> Person
              </Radio.Button>
              <Radio.Button value="company">
                <BankOutlined /> Selskap
              </Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Card>

        <Row gutter={24}>
          <Col span={12}>
            <Card title="Identifikasjon" size="small">
              <Form.Item
                label="Navn"
                name="name"
                rules={[{ required: true, message: "Navn er påkrevd" }]}
              >
                <Input
                  placeholder={
                    shareholderType === "person"
                      ? "Ola Nordmann"
                      : "Eksempel AS"
                  }
                />
              </Form.Item>

              {shareholderType === "company" ? (
                <Form.Item
                  label="Organisasjonsnummer"
                  name="org_number"
                  rules={[
                    { pattern: /^\d{9}$/, message: "Org.nr. må være 9 siffer" },
                  ]}
                >
                  <Input placeholder="123456789" maxLength={9} />
                </Form.Item>
              ) : (
                <Form.Item
                  label="Fødselsdato"
                  name="birth_date"
                >
                  <DatePicker
                    style={{ width: "100%" }}
                    format="DD.MM.YYYY"
                    placeholder="Velg dato"
                  />
                </Form.Item>
              )}
            </Card>
          </Col>

          <Col span={12}>
            <Card title="Kontaktinformasjon" size="small">
              <Form.Item label="E-post" name="email">
                <Input placeholder="epost@eksempel.no" type="email" />
              </Form.Item>

              <Form.Item label="Telefon" name="phone">
                <Input placeholder="+47 123 45 678" />
              </Form.Item>
            </Card>
          </Col>
        </Row>

        <Card title="Adresse" size="small" style={{ marginTop: 24 }}>
          <Row gutter={24}>
            <Col span={16}>
              <Form.Item label="Adresse" name="address">
                <Input placeholder="Gateadresse 1" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="Land"
                name="country"
                rules={[{ required: true }]}
              >
                <Select>
                  {countries.map((c) => (
                    <Option key={c.code} value={c.code}>
                      {c.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={6}>
              <Form.Item label="Postnummer" name="postal_code">
                <Input placeholder="0001" maxLength={10} />
              </Form.Item>
            </Col>
            <Col span={18}>
              <Form.Item label="Sted" name="city">
                <Input placeholder="Oslo" />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      </Form>
    </Create>
  );
};
