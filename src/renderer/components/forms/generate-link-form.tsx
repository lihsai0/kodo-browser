import {clipboard} from "electron";

import React, {Fragment, PropsWithChildren, useEffect, useMemo} from "react";
import classNames from "classnames";
import {toast} from "react-hot-toast";
import {Alert, Button, Form, InputGroup, Spinner} from "react-bootstrap";
import {SubmitHandler, UseFormReturn} from "react-hook-form";

import {BackendMode} from "@common/qiniu";
import {Translate, useI18n} from "@renderer/modules/i18n";
import {EndpointType, useAuth} from "@renderer/modules/auth";
import {DomainAdapter, NON_OWNED_DOMAIN} from "@renderer/modules/qiniu-client-hooks";
import Duration from "@common/const/duration";

export const DEFAULT_EXPIRE_AFTER = 600;

// utils
export const getSelectedDomain = (
  domainList: DomainAdapter[],
  domainName: string,
  defaultDomain?: DomainAdapter,
): DomainAdapter | undefined => {
  if (domainName === defaultDomain?.name) {
    return defaultDomain;
  }
  return domainList.find(d => d.name === domainName);
}

// form data interface
export interface GenerateLinkFormData {
  domainName: string,
  expireAfter: number, // seconds
}

export interface GenerateLinkSubmitData extends GenerateLinkFormData {
  domain: DomainAdapter | undefined,
}

// component
interface GenerateLinkFormProps {
  filePath?: string,
  fileName?: string, // only for show text
  fileLink?: string,
  validateDomainName?: boolean
  formController: UseFormReturn<GenerateLinkFormData>
  loadingDomains?: boolean,
  domains: DomainAdapter[],
  defaultDomain?: DomainAdapter,
  onReloadDomains?: () => Promise<void>,
  onSubmit: SubmitHandler<GenerateLinkSubmitData>,

  // portal
  submitButtonPortal?: React.FC<PropsWithChildren>,
}

const GenerateLinkForm: React.FC<GenerateLinkFormProps> = ({
  filePath,
  fileName,
  fileLink,
  validateDomainName = true,
  formController,
  loadingDomains,
  domains,
  defaultDomain,
  onReloadDomains,
  onSubmit,

  submitButtonPortal: SubmitButtonPortal,
}) => {
  const {currentUser} = useAuth();
  const {translate} = useI18n();

  const memoDefaultDomain = useMemo(() => defaultDomain, []);

  // form for generating link
  const {
    handleSubmit,
    register,
    watch,
    trigger,
    formState: {
      errors,
      isValid,
      isSubmitting,
      isSubmitSuccessful,
    },
  } = formController;

  useEffect(() => {
    trigger();
  }, []);

  const handleReloadDomains = () => {
    if (!onReloadDomains) {
      return
    }
    toast.promise(onReloadDomains(), {
      loading: translate("common.refreshing"),
      success: translate("common.refreshed"),
      error: err => `${translate("common.failed")}: ${err}`,
    });
  };

  const handleSubmitGenerateFileLink: SubmitHandler<GenerateLinkFormData> =
    (data, event) =>
      onSubmit({
        ...data,
        domain: getSelectedDomain(domains, data.domainName, memoDefaultDomain),
      }, event);

  const handleCopyFileLink = () => {
    if (!fileLink) {
      return;
    }
    clipboard.writeText(fileLink);
    toast.success(translate("forms.generateLink.fileLink.copied"));
  };

  const validateDomain = (domainName: string) => {
    if (!validateDomainName) {
      return true;
    }
    const domain = getSelectedDomain(domains, domainName, memoDefaultDomain);
    if (domain?.backendMode === BackendMode.S3 && !filePath) {
      return translate("forms.generateLink.domainName.feedback.emptyFileNameByS3Hint");
    }
    return true;
  }

  // some calculate state
  const selectedDomain = getSelectedDomain(domains, watch("domainName"), memoDefaultDomain);

  // render
  return (
    <>
      <Form
        className="mx-5"
        onSubmit={handleSubmit(handleSubmitGenerateFileLink)}
      >
        <div
          className="grid-auto grid-form label-col-1"
        >
          <fieldset
            className="d-contents"
            disabled={isSubmitting || isSubmitSuccessful}
          >
            {
              fileName === undefined
                ? null
                : <Form.Group as={Fragment} controlId="fileName">
                  <Form.Label className="text-end" >
                    {translate("forms.generateLink.fileName.label")}
                  </Form.Label>
                  <div>
                    <Form.Control
                      plaintext
                      readOnly
                      defaultValue={fileName}
                    />
                  </div>
                </Form.Group>
            }
            {
              currentUser?.endpointType === EndpointType.Private
                ? null
                : <Form.Group as={Fragment} controlId="domainName">
                  <Form.Label className="text-end" >
                    {translate("forms.generateLink.domainName.label")}
                  </Form.Label>
                  <div>
                    <InputGroup hasValidation>
                      <Form.Select
                        {...register("domainName", {
                          validate: validateDomain
                        })}
                        isInvalid={Boolean(errors.domainName)}
                      >
                        {
                          memoDefaultDomain
                            ? <option value={memoDefaultDomain.name}>
                              {
                                memoDefaultDomain.name === NON_OWNED_DOMAIN.name
                                  ? translate("forms.generateLink.domainName.nonOwnedDomain")
                                  : memoDefaultDomain.name
                              }
                            </option>
                            : null
                        }
                        {
                          domains
                            .filter(domain => domain.name !== memoDefaultDomain?.name)
                            .map(domain => (
                              <option key={domain.name} value={domain.name}>
                                {
                                  domain.name === NON_OWNED_DOMAIN.name
                                    ? translate("forms.generateLink.domainName.nonOwnedDomain")
                                    : domain.name
                                }
                              </option>
                            ))
                        }
                      </Form.Select>
                      {
                        onReloadDomains &&
                        <Button
                          variant="outline-solid-gray-400"
                          onClick={handleReloadDomains}
                        >
                          <i
                            className={classNames(
                              "bi bi-arrow-repeat",
                              {
                                "loading-spin": loadingDomains,
                              },
                            )}
                          />
                        </Button>
                      }
                      <Form.Control.Feedback type="invalid">
                        {errors.domainName?.message}
                      </Form.Control.Feedback>
                    </InputGroup>
                  </div>
                </Form.Group>
            }
            {
              !selectedDomain
                ? <Alert className="grid-col-1-fill-rest">
                  {translate("forms.generateLink.errors.domainNotFound")}
                </Alert>
                : selectedDomain.private
                  ? <Form.Group as={Fragment} controlId="expireAfter">
                    <Form.Label className="text-end" >
                      {translate("forms.generateLink.expireAfter.label")}
                    </Form.Label>
                    <div>
                      <InputGroup>
                        <Form.Control
                          {...register("expireAfter", {
                            valueAsNumber: true,
                            required: true,
                            min: 1,
                            max: selectedDomain.linkMaxLifetime / Duration.Second,
                          })}
                          type="number"
                          isInvalid={Boolean(errors.expireAfter)}
                        />
                        <InputGroup.Text>
                          {translate("forms.generateLink.expireAfter.suffix")}
                        </InputGroup.Text>
                      </InputGroup>
                      <Form.Text
                        className={
                          Boolean(errors.expireAfter)
                            ? "text-danger"
                            : ""
                        }
                      >
                        <Translate
                          i18nKey="forms.generateLink.expireAfter.hint"
                          data={{
                            min: "1",
                            max: (selectedDomain.linkMaxLifetime / Duration.Second).toString(),
                          }}
                        />
                      </Form.Text>
                    </div>
                  </Form.Group>
                  : null
            }
          </fieldset>

          <Form.Group
            as={Fragment}
            controlId="fileLink"
          >
            <Form.Label
              className={classNames(
                "text-end",
                {
                  "invisible-no-h": !fileLink,
                }
              )}
            >
              {translate("forms.generateLink.fileLink.label")}
            </Form.Label>
            <div className={classNames({
              "invisible-no-h": !fileLink,
            })}>
              <InputGroup>
                <Form.Control
                  type="text"
                  value={fileLink || ""}
                  readOnly
                />
                <Button
                  variant="info"
                  onClick={handleCopyFileLink}
                >
                  <i className="fa fa-clone text-white"/>
                </Button>
              </InputGroup>
            </div>
          </Form.Group>
        </div>
      </Form>
      {
        SubmitButtonPortal && !isSubmitSuccessful
          ? <SubmitButtonPortal>
            <Button
              variant="primary"
              size="sm"
              disabled={!isValid || isSubmitting}
              onClick={handleSubmit(handleSubmitGenerateFileLink)}
            >
              {
                isSubmitting
                  ? <>
                    <Spinner className="me-1" animation="border" size="sm"/>
                    {translate("common.submitting")}
                  </>
                  : translate("common.submit")
              }
            </Button>
          </SubmitButtonPortal>
          : null
      }
    </>
  );
};

export default GenerateLinkForm;
