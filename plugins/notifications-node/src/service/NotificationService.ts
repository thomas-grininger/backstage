/*
 * Copyright 2023 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Notification } from '@backstage/plugin-notifications-common';
import { CatalogApi, CatalogClient } from '@backstage/catalog-client';
import { NotificationsStore } from '../database/NotificationsStore';
import { v4 as uuid } from 'uuid';
import {
  Entity,
  isGroupEntity,
  isUserEntity,
  RELATION_HAS_MEMBER,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import {
  PluginDatabaseManager,
  PluginEndpointDiscovery,
} from '@backstage/backend-common';
import { DatabaseNotificationsStore } from '../database';

/** @public */
export type NotificationServiceOptions = {
  database: PluginDatabaseManager;
  discovery: PluginEndpointDiscovery;
};

/** @public */
export class NotificationService {
  private store: NotificationsStore | null = null;

  private constructor(
    private readonly database: PluginDatabaseManager,
    private readonly catalog: CatalogApi,
  ) {}

  static create({
    database,
    discovery,
  }: NotificationServiceOptions): NotificationService {
    const catalogClient = new CatalogClient({
      discoveryApi: discovery,
    });

    return new NotificationService(database, catalogClient);
  }

  async send(
    entityRef: string | string[],
    title: string,
    description: string,
    link: string,
  ): Promise<Notification[]> {
    const users = await this.getUsersForEntityRef(entityRef);
    const notifications = [];
    const store = await this.getStore();
    for (const user of users) {
      const notification = {
        id: uuid(),
        userRef: user,
        title,
        description,
        link,
        created: new Date(),
      };

      await store.saveNotification(notification);
      notifications.push(notification);
    }

    // TODO: Signal service
    // TODO: Other senders

    return notifications;
  }

  async getStore(): Promise<NotificationsStore> {
    if (!this.store) {
      this.store = await DatabaseNotificationsStore.create({
        database: this.database,
      });
    }
    return this.store;
  }

  private async getUsersForEntityRef(
    entityRef: string | string[],
  ): Promise<string[]> {
    const refs = Array.isArray(entityRef) ? entityRef : [entityRef];
    const entities = await this.catalog.getEntitiesByRefs({ entityRefs: refs });

    const mapEntity = async (entity: Entity | undefined): Promise<string[]> => {
      if (!entity) {
        return [];
      }

      if (isUserEntity(entity)) {
        return [stringifyEntityRef(entity)];
      } else if (isGroupEntity(entity) && entity.relations) {
        return entity.relations
          .filter(
            relation =>
              relation.type === RELATION_HAS_MEMBER && relation.targetRef,
          )
          .map(r => r.targetRef);
      } else if (!isGroupEntity(entity) && entity.spec?.owner) {
        const owner = await this.catalog.getEntityByRef(
          entity.spec.owner as string,
        );
        if (owner) {
          return mapEntity(owner);
        }
      }

      return [];
    };

    const users: string[] = [];
    for (const entity of entities.items) {
      const u = await mapEntity(entity);
      users.push(...u);
    }
    return users;
  }
}
