import { getClient } from 'azure-devops-extension-api/Common';
import { CoreRestClient, ProjectProperty } from 'azure-devops-extension-api/Core';
import { IdentityRef } from 'azure-devops-extension-api/WebApi';
import {
  WorkItem,
  WorkItemExpand,
  WorkItemField,
  WorkItemTrackingRestClient,
  WorkItemType
} from 'azure-devops-extension-api/WorkItemTracking';
import {
  GetProcessExpandLevel,
  ProcessInfo,
  WorkItemTrackingProcessRestClient
} from 'azure-devops-extension-api/WorkItemTrackingProcess';

import { getChildIds, getParentId } from '../workItemUtils';
import DevOpsService, { IDevOpsService } from './DevOpsService';

export interface IWorkItemService {
  getParentForWorkItem(id: number, workItem?: WorkItem): Promise<WorkItem | undefined>;
  getChildrenForWorkItem(id: number, workItem?: WorkItem): Promise<WorkItem[] | undefined>;
  getWorkItemTypes(fromProcess?: boolean): Promise<WorkItemType[]>;
  getWorkItem(id: number): Promise<WorkItem>;
  getWorkItems(ids: number[]): Promise<WorkItem[]>;
  setWorkItemState(
    id: number,
    state: string,
    setAssigneeValue?: boolean,
    assignee?: IdentityRef | undefined
  ): Promise<WorkItem>;
  getProcessTemplateName(): Promise<string | undefined>;
  getProcessInfo(includeProject?: boolean): Promise<ProcessInfo | undefined>;
}

class WorkItemService implements IWorkItemService {
  private _devOpsService: IDevOpsService;
  private _processTemplateTypeKey = 'System.ProcessTemplateType';
  constructor(devOpsService?: IDevOpsService) {
    this._devOpsService = devOpsService ?? new DevOpsService();
  }

  public async getParentForWorkItem(
    id: number,
    workItem?: WorkItem
  ): Promise<WorkItem | undefined> {
    const wi = workItem || (await this.getWorkItem(id));
    const parentId = getParentId(wi);
    if (parentId === undefined) return undefined;
    const parentWi = await this.getWorkItem(parentId);
    return parentWi;
  }

  public async getChildrenForWorkItem(
    id: number,
    workItem?: WorkItem
  ): Promise<WorkItem[] | undefined> {
    const wi = workItem || (await this.getWorkItem(id));
    const childIds = getChildIds(wi);
    if (childIds === undefined) return undefined;
    const wis = await this.getWorkItems(childIds);
    return wis;
  }

  private sortWorkItemTypes(a: WorkItemType, b: WorkItemType) {
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return 0;
  }

  private async getProjectProperties(projectId: string): Promise<ProjectProperty[]> {
    const coreClient = getClient(CoreRestClient);
    const props = await coreClient.getProjectProperties(projectId);
    return props;
  }

  public async getProcessInfo(
    includeProject = false,
    getParent = false
  ): Promise<ProcessInfo | undefined> {
    const project = await this._devOpsService.getProject();

    if (project) {
      const props = await this.getProjectProperties(project.id);
      const processClient = getClient(WorkItemTrackingProcessRestClient);
      const processId = props.find(x => x.name === this._processTemplateTypeKey)?.value;
      if (processId) {
        const process = await processClient.getProcessByItsId(
          processId,
          includeProject ? GetProcessExpandLevel.Projects : undefined
        );
        if (
          process.parentProcessTypeId !== undefined &&
          process.parentProcessTypeId !== '00000000-0000-0000-0000-000000000000' &&
          getParent
        ) {
          const parentProcess = await processClient.getProcessByItsId(
            process.parentProcessTypeId,
            includeProject ? GetProcessExpandLevel.Projects : undefined
          );
          return parentProcess;
        } else {
          return process;
        }
      }

      return undefined;
    }
  }
  public async getProcessTemplateName(): Promise<string | undefined> {
    const processInfo = await this.getProcessInfo(false, true);
    return processInfo?.name;
  }

  public async getWorkItemTypes(fromProcess?: boolean): Promise<WorkItemType[]> {
    const project = await this._devOpsService.getProject();
    if (project) {
      const client = getClient(WorkItemTrackingRestClient);
      const types = await client.getWorkItemTypes(project.name);
      if (fromProcess) {
        const processClient = getClient(WorkItemTrackingProcessRestClient);
        const props = await this.getProjectProperties(project.id);
        const processId = props.find(x => x.name === this._processTemplateTypeKey)?.value;
        if (processId === undefined) {
          return types.sort(this.sortWorkItemTypes);
        }

        const wits = await processClient.getProcessWorkItemTypes(processId);

        return types
          .filter(x => wits.some(y => y.referenceName === x.referenceName))
          .sort(this.sortWorkItemTypes);
      } else {
        return types.sort(this.sortWorkItemTypes);
      }
    }
    return [];
  }

  public async getWorkItemFields(): Promise<WorkItemField[]> {
    const project = await this._devOpsService.getProject();
    if (project) {
      const client = getClient(WorkItemTrackingRestClient);
      const fields = await client.getFields(project.name);
      return fields;
    }
    return [];
  }

  public async getWorkItem(id: number): Promise<WorkItem> {
    const client = getClient(WorkItemTrackingRestClient);
    const wit = await client.getWorkItem(
      id,
      undefined,
      undefined,
      undefined,
      WorkItemExpand.Relations
    );
    return wit;
  }

  public async getWorkItems(ids: number[]): Promise<WorkItem[]> {
    const client = getClient(WorkItemTrackingRestClient);
    const wit = await client.getWorkItems(
      ids,
      undefined,
      undefined,
      undefined,
      WorkItemExpand.Relations
    );
    return wit;
  }

  public async setWorkItemState(
    id: number,
    state: string,
    setAssigneeValue?: boolean,
    assignee?: IdentityRef | undefined
  ): Promise<WorkItem> {
    const client = getClient(WorkItemTrackingRestClient);

    const stateData = [
      {
        op: 'add',
        path: '/fields/System.State',
        value: state
      }
    ];

    const payload =
      setAssigneeValue === true
        ? [
            ...stateData,
            {
              op: 'add',
              path: '/fields/System.AssignedTo',
              value: assignee === undefined ? '' : assignee
            }
          ]
        : stateData;

    const updated = await client.updateWorkItem(payload, id);
    return updated;
  }
}
export default WorkItemService;
